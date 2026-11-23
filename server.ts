import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer } from 'ws';
import { runFinancialAssistant } from './src/server/aiAssistant.ts';
import {
  adjustCentralFundPool,
  assertUserEntitlement,
  createCentralFundPool,
  createNotification,
  executeCardTopup,
  executeFxConversion,
  executeReversal,
  executeSandboxDeposit,
  executeTransfer,
  ForbiddenError,
  getOperationSetting,
  maybeEmitHighValueAlert,
  transferBetweenCentralFundPools,
  writeAuditLog,
} from './src/server/coreBanking.ts';
import {
  db,
  ensureMerchantForUser,
  exportFullDatabaseSql,
  getDatabaseTableStats,
  getPrimaryClearingPool,
  getSystemOperationSettings,
  getUserEntitlements,
  hashPassword,
  initDatabase,
  upsertSystemOperationSetting,
  upsertUserEntitlements,
  verifyPassword,
} from './src/server/db.ts';
import {
  broadcastSync,
  getConnectedClientCount,
  getRealtimeBreakdown,
  registerSseClient,
  registerWsClient,
  unregisterSseClient,
  unregisterWsClient,
} from './src/server/realtime.ts';
import { generateTurkishCardNumber, maskPan } from './src/shared/cardUtils.ts';
import type { UserRole, VerificationType } from './src/shared/types.ts';

dotenv.config();
initDatabase();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Security Firewall Headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(express.json({ limit: '2mb' }));

// Strip dangerous prototype-pollution keys from incoming JSON bodies
function sanitizePayload(val: unknown): unknown {
  if (!val || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(sanitizePayload);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = sanitizePayload(v);
  }
  return out;
}

app.use((req, _res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizePayload(req.body);
  }
  next();
});

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || 'promoney-dev-ephemeral-secret-2026';

// Sliding-window API & Auth Firewall Rate Limiter
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const apiTrafficMap = new Map<string, { count: number; resetAt: number }>();

function apiFirewallRateLimit(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith('/api')) return next();
  if (req.path === '/api/events' || req.path === '/api/health') return next();
  const isAuthEndpoint = req.path.startsWith('/api/auth/login') || req.path.startsWith('/api/auth/register') || req.path.startsWith('/api/support/unlock-request');
  const windowMs = 60 * 1000;
  const maxReq = isAuthEndpoint ? 30 : 320;
  const bucketKey = `${req.ip || 'local'}:${isAuthEndpoint ? 'auth' : 'api'}`;
  const now = Date.now();
  const entry = apiTrafficMap.get(bucketKey);
  if (!entry || entry.resetAt <= now) {
    apiTrafficMap.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return next();
  }
  entry.count += 1;
  if (entry.count > maxReq) {
    return res.status(429).json({ error: 'Güvenlik duvarı: Çok fazla istek gönderildi. Lütfen kısa süre bekleyin.' });
  }
  next();
}

app.use(apiFirewallRateLimit);

const ADMIN_ROLES = new Set<UserRole>([
  'SUPER_ADMIN',
  'SYSTEM_ADMIN',
  'FINANCE_ADMIN',
  'COMPLIANCE_OFFICER',
  'AML_OFFICER',
  'RISK_MANAGER',
  'BRANCH_MANAGER',
  'CUSTOMER_SUPPORT',
  'AUDITOR',
]);

interface AuthContext {
  userId: string;
  sessionId: string;
  tenantId: string;
  email: string;
  role: UserRole;
  fullName: string;
}

interface AuthedRequest extends Request {
  auth?: AuthContext;
}

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function hashToken(rawToken: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(rawToken).digest('hex');
}

function authenticateToken(rawToken: string | undefined): AuthContext | null {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const row = db
    .prepare(
      `SELECT s.id as session_id, s.user_id, s.revoked, u.tenant_id, u.email, u.role, u.full_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as any;
  if (!row || row.revoked === 1) return null;
  db.prepare('UPDATE sessions SET last_active_at = ? WHERE id = ?').run(new Date().toISOString(), row.session_id);
  return {
    userId: row.user_id,
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    email: row.email,
    role: row.role as UserRole,
    fullName: row.full_name,
  };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
  const ctx = authenticateToken(token);
  if (!ctx) {
    return res.status(401).json({ error: 'Authentication required. Please sign in to PRO MONEY.' });
  }
  req.auth = ctx;
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth || !ADMIN_ROLES.has(req.auth.role)) {
    return res.status(403).json({ error: 'Forbidden: Administrator or Compliance role required.' });
  }
  next();
}

function mapUserRow(u: any) {
  return {
    id: u.id,
    tenantId: u.tenant_id,
    customerNumber: u.customer_number || '100000',
    email: u.email,
    fullName: u.full_name,
    phone: u.phone,
    country: u.country,
    role: u.role,
    accountCategory: u.account_category,
    membershipTier: u.membership_tier,
    kycStatus: u.kyc_status,
    approvalStatus: u.approval_status || 'APPROVED',
    requestedCompanyName: u.requested_company_name || null,
    requestedTaxId: u.requested_tax_id || null,
    nationalIdNumber: u.national_id_number || null,
    passportNumber: u.passport_number || null,
    addressLine: u.address_line || null,
    city: u.city || null,
    postalCode: u.postal_code || null,
    identityVerified: Boolean(u.identity_verified),
    passportVerified: Boolean(u.passport_verified),
    addressVerified: Boolean(u.address_verified),
    phoneVerified: Boolean(u.phone_verified),
    mfaEnabled: Boolean(u.mfa_enabled),
    passkeyCount: u.passkey_count,
    highValueAlertsEnabled: u.high_value_alerts_enabled === undefined ? true : Boolean(u.high_value_alerts_enabled),
    highValueAlertThreshold: Number(u.high_value_alert_threshold ?? 5000),
    biometricEnabled: Boolean(u.biometric_enabled),
    failedLoginAttempts: Number(u.failed_login_attempts ?? 0),
    isLocked: Boolean(u.is_locked),
    lockedUntil: u.locked_until || null,
    lockReason: u.lock_reason || null,
    entitlements: getUserEntitlements(u.id),
    createdAt: u.created_at,
  };
}

function mapVerificationRow(v: any) {
  return {
    id: v.id,
    userId: v.user_id,
    subjectName: v.subject_name || undefined,
    customerNumber: v.customer_number || undefined,
    verificationType: v.verification_type as VerificationType,
    documentNumber: v.document_number || null,
    issuingCountry: v.issuing_country || null,
    expiryDate: v.expiry_date || null,
    addressFull: v.address_full || null,
    city: v.city || null,
    postalCode: v.postal_code || null,
    phoneNumber: v.phone_number || null,
    proofReference: v.proof_reference || null,
    status: v.status,
    rejectionReason: v.rejection_reason || null,
    verifiedBy: v.verified_by || null,
    verifiedAt: v.verified_at || null,
    createdAt: v.created_at,
  };
}

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function mapAccountRow(a: any) {
  return {
    id: a.id,
    tenantId: a.tenant_id,
    userId: a.user_id,
    businessId: a.business_id,
    accountNumber: a.account_number,
    iban: a.iban,
    bic: a.bic,
    type: a.type,
    label: a.label,
    currency: a.currency,
    availableBalance: Number(a.available_balance),
    ledgerBalance: Number(a.ledger_balance),
    blockedAmount: Number(a.blocked_amount),
    pendingAmount: Number(a.pending_amount),
    status: a.status,
    isSandbox: Boolean(a.is_sandbox),
    createdAt: a.created_at,
  };
}

function mapCardRow(c: any) {
  return {
    id: c.id,
    tenantId: c.tenant_id,
    userId: c.user_id,
    accountId: c.account_id,
    holderName: c.holder_name,
    maskedPan: c.pan_formatted ? maskPan(c.pan_formatted) : `•••• •••• •••• ${c.last4}`,
    last4: c.last4,
    issuerLabel: c.issuer_label || null,
    creditLimit: Number(c.credit_limit || 0),
    expiry: c.expiry,
    scheme: c.scheme,
    productType: c.product_type,
    designVariant: c.design_variant,
    status: c.status,
    onlineEnabled: Boolean(c.online_enabled),
    contactlessEnabled: Boolean(c.contactless_enabled),
    atmEnabled: Boolean(c.atm_enabled),
    dailyLimit: Number(c.daily_limit),
    monthlyLimit: Number(c.monthly_limit),
    spentToday: Number(c.spent_today),
    spentMonth: Number(c.spent_month),
    deliveryStatus: c.delivery_status,
    isSandbox: Boolean(c.is_sandbox),
    createdAt: c.created_at,
  };
}

function mapTerminalRow(t: any) {
  return {
    id: t.id,
    merchantId: t.merchant_id,
    ownerUserId: t.owner_user_id || null,
    ownerName: t.owner_name || null,
    serialNumber: t.serial_number,
    model: t.model,
    locationName: t.location_name,
    status: t.status,
    terminalMode: (t.terminal_mode || 'ONLINE') as 'ONLINE' | 'OFFLINE' | 'HYBRID',
    approvalStatus: (t.approval_status || 'APPROVED') as 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED',
    onlineEnabled: Boolean(t.online_enabled),
    offlineEnabled: Boolean(t.offline_enabled),
    offlineFloorLimit: Number(t.offline_floor_limit ?? 2500),
    offlineQueuedCount: Number(t.offline_queued_count ?? 0),
    offlineQueuedAmount: Number(t.offline_queued_amount ?? 0),
    approvedBy: t.approved_by || null,
    approvedAt: t.approved_at || null,
    supportsContactless: Boolean(t.supports_contactless),
    supportsQr: Boolean(t.supports_qr),
    supportsOfflineRules: Boolean(t.supports_offline_rules),
    lastHeartbeat: t.last_heartbeat,
  };
}

function mapOfflineQueueRow(q: any) {
  return {
    id: q.id,
    terminalId: q.terminal_id,
    terminalSerial: q.terminal_serial || undefined,
    terminalLocation: q.terminal_location || undefined,
    merchantId: q.merchant_id,
    ownerUserId: q.owner_user_id,
    amount: Number(q.amount),
    currency: q.currency,
    cardLast4: q.card_last4,
    cardScheme: q.card_scheme,
    reference: q.reference,
    authCode: q.auth_code,
    status: q.status,
    createdAt: q.created_at,
    settledAt: q.settled_at || null,
  };
}

function mapTxRow(t: any) {
  return {
    id: t.id,
    idempotencyKey: t.idempotency_key,
    tenantId: t.tenant_id,
    userId: t.user_id,
    fromAccountId: t.from_account_id,
    toAccountId: t.to_account_id,
    counterpartyName: t.counterparty_name,
    counterpartyIban: t.counterparty_iban,
    type: t.type,
    category: t.category,
    amount: Number(t.amount),
    fee: Number(t.fee),
    currency: t.currency,
    direction: t.direction,
    status: t.status,
    reference: t.reference,
    source: t.source,
    authorizationCode: t.authorization_code,
    isSandbox: Boolean(t.is_sandbox),
    createdAt: t.created_at,
  };
}

// ---------- HEALTH ----------
app.get('/api/health', (_req, res) => {
  res.json({
    platform: 'PRO MONEY',
    status: 'OK',
    environment: process.env.NODE_ENV || 'development',
    database: 'SQLite (WAL) / Production Postgres Ready',
    realtimeClients: getConnectedClientCount(),
    timestamp: new Date().toISOString(),
  });
});

// ---------- AUTHENTICATION ----------
app.post('/api/auth/login', (req, res) => {
  const rawIdentifier = String(req.body?.identifier || req.body?.email || '').trim();
  const identifierLower = rawIdentifier.toLowerCase();
  const identifierDigits = normalizeDigits(rawIdentifier);
  const password = String(req.body?.password || '');
  const loginPortal = String(req.body?.loginPortal || 'ANY').toUpperCase();
  const companyIdentifier = String(req.body?.companyIdentifier || '').trim();
  const deviceLabel = String(req.body?.deviceLabel || req.headers['user-agent']?.slice(0, 60) || 'Web Browser');

  if (!rawIdentifier || !password) {
    return res.status(400).json({ error: 'Phone/Customer ID/Email and password are required.' });
  }

  if (loginPortal === 'CORPORATE' && !companyIdentifier) {
    return res.status(400).json({ error: 'Şirket girişi için Şirket Ünvanı veya Vergi No girilmesi zorunludur.' });
  }

  const key = `${req.ip}:${identifierLower}`;
  const attempt = loginAttempts.get(key);
  if (attempt && attempt.resetAt > Date.now() && attempt.count >= 8) {
    return res.status(429).json({ error: 'Too many login attempts. Please wait 60 seconds.' });
  }

  let user = db
    .prepare('SELECT * FROM users WHERE LOWER(email) = ? OR customer_number = ?')
    .get(identifierLower, rawIdentifier) as any;

  if (!user && identifierDigits.length >= 7) {
    const tail10 = identifierDigits.slice(-10);
    const allUsers = db.prepare('SELECT * FROM users').all() as any[];
    user = allUsers.find((candidate) => {
      const candidateDigits = normalizeDigits(String(candidate.phone || ''));
      if (!candidateDigits) return false;
      return candidateDigits === identifierDigits || (tail10.length === 10 && candidateDigits.endsWith(tail10));
    });
  }

  if (!user) {
    const nextCount = attempt && attempt.resetAt > Date.now() ? attempt.count + 1 : 1;
    loginAttempts.set(key, { count: nextCount, resetAt: Date.now() + 60000 });
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  // Check if account is currently locked
  if (user.is_locked === 1) {
    const lockUntilMs = user.locked_until ? new Date(user.locked_until).getTime() : 0;
    if (!user.locked_until || lockUntilMs > Date.now()) {
      return res.status(423).json({
        error: 'Hesabınız ardışık hatalı şifre denemeleri veya güvenlik nedeniyle geçici olarak kilitlendi. Müşteri hizmetlerinden kilidi açtırabilirsiniz.',
        accountLocked: true,
        lockedUntil: user.locked_until || null,
        lockReason: user.lock_reason || 'Security lockout',
        customerNumber: user.customer_number,
      });
    }
    // Auto-reset expired temporary lock
    db.prepare(`UPDATE users SET is_locked = 0, failed_login_attempts = 0, locked_until = NULL, lock_reason = NULL WHERE id = ?`).run(user.id);
    user.is_locked = 0;
    user.failed_login_attempts = 0;
  }

  if (!verifyPassword(password, user.password_hash)) {
    const nextCount = attempt && attempt.resetAt > Date.now() ? attempt.count + 1 : 1;
    loginAttempts.set(key, { count: nextCount, resetAt: Date.now() + 60000 });

    const nextFailed = Number(user.failed_login_attempts || 0) + 1;
    if (nextFailed >= 3) {
      const lockedUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const lockReason = '3 ardışık hatalı şifre denemesi nedeniyle otomatik kilitlendi';
      db.prepare(
        `UPDATE users SET failed_login_attempts = ?, is_locked = 1, locked_until = ?, lock_reason = ? WHERE id = ?`
      ).run(nextFailed, lockedUntil, lockReason, user.id);

      writeAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: 'ACCOUNT_LOCKED_BRUTE_FORCE',
        targetType: 'USER',
        targetId: user.id,
        metadata: `Locked after ${nextFailed} failed password attempts until ${lockedUntil}`,
      });

      const supportAdmins = db
        .prepare("SELECT id FROM users WHERE role IN ('SUPER_ADMIN', 'CUSTOMER_SUPPORT', 'COMPLIANCE_OFFICER', 'SYSTEM_ADMIN')")
        .all() as Array<{ id: string }>;
      for (const adm of supportAdmins) {
        createNotification(
          adm.id,
          `Güvenlik Kilidi: ${user.full_name}`,
          `#${user.customer_number} (${user.email}) hesabı 3 hatalı şifre girişi nedeniyle geçici olarak kilitlendi.`,
          'ALERT'
        );
      }
      broadcastSync({ type: 'security:alert', tenantId: user.tenant_id, data: { event: 'ACCOUNT_LOCKED', userId: user.id } });
      broadcastSync({ type: 'admin:sync', tenantId: user.tenant_id, data: { event: 'ACCOUNT_LOCKED', userId: user.id } });

      return res.status(423).json({
        error: 'Ardışık 3 hatalı şifre girişi nedeniyle hesabınız 30 dakika kilitlendi. Müşteri Hizmetleri üzerinden kilidi açtırabilirsiniz.',
        accountLocked: true,
        lockedUntil,
        lockReason,
        customerNumber: user.customer_number,
      });
    }

    db.prepare(`UPDATE users SET failed_login_attempts = ? WHERE id = ?`).run(nextFailed, user.id);
    const remainingAttempts = Math.max(0, 3 - nextFailed);
    return res.status(401).json({
      error: `Hatalı şifre. Kalan deneme hakkınız: ${remainingAttempts}`,
      remainingAttempts,
    });
  }

  loginAttempts.delete(key);
  if (Number(user.failed_login_attempts || 0) > 0 || user.is_locked === 1) {
    db.prepare(`UPDATE users SET failed_login_attempts = 0, is_locked = 0, locked_until = NULL, lock_reason = NULL WHERE id = ?`).run(user.id);
  }

  const isCorporateRole =
    user.role === 'BUSINESS_MANAGER' || user.role === 'CORPORATE_CUSTOMER' || user.role === 'MERCHANT';
  const isAdminRole = ADMIN_ROLES.has(user.role as UserRole);
  const isPersonalRole = user.role === 'INDIVIDUAL_CUSTOMER';

  if (loginPortal === 'PERSONAL' && !isPersonalRole) {
    return res.status(403).json({
      error: isAdminRole
        ? 'Yönetici hesapları Bireysel Giriş ekranından giremez. Yönetim Paneli girişini kullanın.'
        : 'Şirket / Kurumsal hesaplar Bireysel Giriş ekranından giremez. Lütfen Kurumsal Giriş sekmesini kullanın.',
    });
  }

  if (loginPortal === 'CORPORATE') {
    if (!isCorporateRole) {
      return res.status(403).json({
        error: 'Kurumsal giriş yalnızca şirket ve üye işyeri hesaplarına özeldir. Bireysel şahıslar Bireysel Giriş kullanmalıdır.',
      });
    }
    const biz = db.prepare('SELECT company_name, tax_id, registration_number FROM businesses WHERE owner_user_id = ?').get(user.id) as any;
    const mer = db.prepare('SELECT business_name FROM merchants WHERE user_id = ?').get(user.id) as any;
    const compLower = companyIdentifier.toLowerCase();
    const candidates = [
      user.requested_company_name,
      user.requested_tax_id,
      biz?.company_name,
      biz?.tax_id,
      biz?.registration_number,
      mer?.business_name,
    ]
      .filter(Boolean)
      .map((s) => String(s).trim().toLowerCase());

    const matched = candidates.some((c) => c === compLower || (compLower.length >= 3 && c.includes(compLower)));
    if (!matched) {
      return res.status(401).json({
        error: 'Girilen Şirket Ünvanı veya Vergi No bilgisi bu kurumsal hesapla eşleşmiyor.',
      });
    }
  }

  if (loginPortal === 'ADMIN' && !isAdminRole) {
    return res.status(403).json({
      error: 'Bu alan yalnızca PRO MONEY Banka Yönetimi personeline özeldir.',
    });
  }

  if (user.approval_status === 'PENDING_APPROVAL') {
    return res.status(403).json({
      error: 'Your account application is awaiting Management Approval.',
      approvalStatus: 'PENDING_APPROVAL',
      customerNumber: user.customer_number,
    });
  }

  if (user.approval_status === 'REJECTED') {
    return res.status(403).json({
      error: 'Your account application was declined by Management.',
      approvalStatus: 'REJECTED',
    });
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const sessionId = uid('ses');
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, device_label, ip_address, revoked, created_at, last_active_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(sessionId, user.id, hashToken(rawToken), deviceLabel, req.ip || '127.0.0.1', now, now);

  writeAuditLog({
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'USER_LOGIN',
    targetType: 'SESSION',
    targetId: sessionId,
    metadata: `Signed in via ${loginPortal} (${deviceLabel})`,
  });

  res.json({
    token: rawToken,
    user: mapUserRow(user),
  });
});

app.post('/api/auth/register', (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const fullName = String(req.body?.fullName || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const country = String(req.body?.country || 'TR').trim().toUpperCase();
    const rawCat = String(req.body?.accountCategory || 'Personal');
    const accountCategory: 'Personal' | 'Business' | 'Merchant' =
      rawCat === 'Business' ? 'Business' : rawCat === 'Merchant' ? 'Merchant' : 'Personal';
    const companyName = String(req.body?.companyName || '').trim() || null;
    const taxId = String(req.body?.taxId || '').trim() || null;
    const nationalIdNumber = String(req.body?.nationalIdNumber || '').trim() || null;
    const passportNumber = String(req.body?.passportNumber || '').trim() || null;
    const addressLine = String(req.body?.addressLine || '').trim() || null;
    const city = String(req.body?.city || '').trim() || null;
    const postalCode = String(req.body?.postalCode || '').trim() || null;

    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (fullName.length < 2) return res.status(400).json({ error: 'Full name is required.' });
    if (normalizeDigits(phone).length < 7) return res.status(400).json({ error: 'Valid phone number is required.' });
    if ((accountCategory === 'Business' || accountCategory === 'Merchant') && !companyName) {
      return res.status(400).json({ error: 'Company / business name is required.' });
    }

    const existingEmail = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email);
    if (existingEmail) return res.status(409).json({ error: 'An account with this email already exists.' });

    const phoneDigits = normalizeDigits(phone).slice(-10);
    const allUsers = db.prepare('SELECT id, phone FROM users').all() as Array<{ id: string; phone: string }>;
    const existingPhone = allUsers.find((u) => normalizeDigits(u.phone).slice(-10) === phoneDigits);
    if (existingPhone) return res.status(409).json({ error: 'An account with this phone number already exists.' });

    const userId = uid('usr');
    const now = new Date().toISOString();
    const role: UserRole =
      accountCategory === 'Business'
        ? 'BUSINESS_MANAGER'
        : accountCategory === 'Merchant'
        ? 'MERCHANT'
        : 'INDIVIDUAL_CUSTOMER';
    const customerNumber = String(Math.floor(400000 + Math.random() * 499999));

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO users (
           id, tenant_id, customer_number, email, password_hash, full_name, phone, country,
           role, account_category, membership_tier, kyc_status, approval_status,
           requested_company_name, requested_tax_id,
           national_id_number, passport_number, address_line, city, postal_code,
           identity_verified, passport_verified, address_verified, phone_verified,
           mfa_enabled, passkey_count, created_at
         )
         VALUES (?, 'tenant_promoney', ?, ?, ?, ?, ?, ?, ?, ?, 'Standard', 'PENDING', 'PENDING_APPROVAL', ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?)`
      ).run(
        userId,
        customerNumber,
        email,
        hashPassword(password),
        fullName,
        phone,
        country,
        role,
        accountCategory,
        companyName,
        taxId,
        nationalIdNumber,
        passportNumber,
        addressLine,
        city,
        postalCode,
        now
      );

      if (nationalIdNumber) {
        db.prepare(
          `INSERT INTO identity_verifications (id, user_id, verification_type, document_number, issuing_country, proof_reference, status, created_at)
           VALUES (?, ?, 'IDENTITY_CARD', ?, ?, 'APPLICATION_FORM', 'PENDING', ?)`
        ).run(uid('ver'), userId, nationalIdNumber, country, now);
      }
      if (passportNumber) {
        db.prepare(
          `INSERT INTO identity_verifications (id, user_id, verification_type, document_number, issuing_country, proof_reference, status, created_at)
           VALUES (?, ?, 'PASSPORT', ?, ?, 'APPLICATION_FORM', 'PENDING', ?)`
        ).run(uid('ver'), userId, passportNumber, country, now);
      }
      if (addressLine) {
        db.prepare(
          `INSERT INTO identity_verifications (id, user_id, verification_type, issuing_country, address_full, city, postal_code, proof_reference, status, created_at)
           VALUES (?, ?, 'ADDRESS', ?, ?, ?, ?, 'APPLICATION_FORM', 'PENDING', ?)`
        ).run(uid('ver'), userId, country, addressLine, city, postalCode, now);
      }

      const adminUsers = db
        .prepare("SELECT id FROM users WHERE role IN ('SUPER_ADMIN', 'COMPLIANCE_OFFICER', 'BRANCH_MANAGER', 'FINANCE_ADMIN')")
        .all() as Array<{ id: string }>;
      for (const adm of adminUsers) {
        createNotification(
          adm.id,
          'New Account Application Pending Approval',
          `${fullName} (${accountCategory}${companyName ? ` · ${companyName}` : ''}) requested a PRO MONEY account (#${customerNumber}).`,
          'WARNING'
        );
      }

      writeAuditLog({
        actorUserId: userId,
        actorEmail: email,
        actorRole: role,
        action: 'ACCOUNT_APPLICATION_SUBMITTED',
        targetType: 'USER',
        targetId: userId,
        metadata: `Submitted ${accountCategory} application (#${customerNumber}) awaiting Management Approval`,
      });

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    broadcastSync({ type: 'admin:sync', tenantId: 'tenant_promoney', data: { event: 'ACCOUNT_APPLICATION_SUBMITTED', userId } });

    res.status(201).json({
      pendingApproval: true,
      status: 'PENDING_APPROVAL',
      customerNumber,
      fullName,
      accountCategory,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Registration failed.' });
  }
});

app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(req.auth!.sessionId);
  res.json({ ok: true });
});

app.get('/api/auth/sessions', requireAuth, (req: AuthedRequest, res) => {
  const rows = db
    .prepare('SELECT id, user_id, device_label, ip_address, created_at, last_active_at FROM sessions WHERE user_id = ? AND revoked = 0 ORDER BY last_active_at DESC')
    .all(req.auth!.userId) as any[];
  res.json(
    rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      deviceLabel: r.device_label,
      ipAddress: r.ip_address,
      createdAt: r.created_at,
      lastActiveAt: r.last_active_at,
      isCurrent: r.id === req.auth!.sessionId,
    }))
  );
});

app.post('/api/auth/sessions/:id/revoke', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.auth!.userId);
  res.json({ ok: true });
});

app.post('/api/auth/mfa/toggle', requireAuth, (req: AuthedRequest, res) => {
  const user = db.prepare('SELECT mfa_enabled FROM users WHERE id = ?').get(req.auth!.userId) as { mfa_enabled: number };
  const nextVal = user.mfa_enabled ? 0 : 1;
  db.prepare('UPDATE users SET mfa_enabled = ? WHERE id = ?').run(nextVal, req.auth!.userId);
  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: nextVal ? 'MFA_ENABLED' : 'MFA_DISABLED',
    targetType: 'USER',
    targetId: req.auth!.userId,
    metadata: 'Updated MFA security state',
  });
  broadcastSync({ type: 'profile:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { mfaEnabled: Boolean(nextVal) } });
  res.json({ mfaEnabled: Boolean(nextVal) });
});

app.post('/api/auth/passkeys/register', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('UPDATE users SET passkey_count = passkey_count + 1 WHERE id = ?').run(req.auth!.userId);
  const updated = db.prepare('SELECT passkey_count FROM users WHERE id = ?').get(req.auth!.userId) as { passkey_count: number };
  createNotification(req.auth!.userId, 'Passkey Registered', 'Hardware/biometric passkey credential bound to your PRO MONEY profile.', 'SUCCESS');
  broadcastSync({ type: 'profile:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { passkeyCount: updated.passkey_count } });
  res.json({ passkeyCount: updated.passkey_count });
});

app.patch('/api/profile', requireAuth, (req: AuthedRequest, res) => {
  const fullName = String(req.body?.fullName || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const country = String(req.body?.country || '').trim().toUpperCase();
  if (!fullName) return res.status(400).json({ error: 'Full name cannot be empty.' });

  db.prepare('UPDATE users SET full_name = ?, phone = ?, country = ? WHERE id = ?').run(fullName, phone, country, req.auth!.userId);
  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: 'PROFILE_UPDATED',
    targetType: 'USER',
    targetId: req.auth!.userId,
    metadata: `Updated profile (${fullName}, ${country})`,
  });
  broadcastSync({ type: 'profile:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { fullName, phone, country } });
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth!.userId);
  res.json(mapUserRow(updated));
});

app.patch('/api/settings/preferences', requireAuth, (req: AuthedRequest, res) => {
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth!.userId) as any;
  if (!current) return res.status(404).json({ error: 'User not found.' });

  const nextAlerts =
    req.body?.highValueAlertsEnabled !== undefined
      ? (req.body.highValueAlertsEnabled ? 1 : 0)
      : Number(current.high_value_alerts_enabled ?? 1);
  const rawThreshold =
    req.body?.highValueAlertThreshold !== undefined
      ? Number(req.body.highValueAlertThreshold)
      : Number(current.high_value_alert_threshold ?? 5000);
  const nextThreshold = Number.isFinite(rawThreshold) ? Math.max(100, Math.min(1000000, rawThreshold)) : 5000;
  const nextBiometric =
    req.body?.biometricEnabled !== undefined
      ? (req.body.biometricEnabled ? 1 : 0)
      : Number(current.biometric_enabled ?? 0);

  db.prepare(
    `UPDATE users SET high_value_alerts_enabled = ?, high_value_alert_threshold = ?, biometric_enabled = ? WHERE id = ?`
  ).run(nextAlerts, nextThreshold, nextBiometric, req.auth!.userId);

  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: 'USER_PREFERENCES_UPDATED',
    targetType: 'USER',
    targetId: req.auth!.userId,
    metadata: `HighValueAlerts=${nextAlerts}, Threshold=${nextThreshold}, Biometric=${nextBiometric}`,
  });

  broadcastSync({
    type: 'profile:updated',
    targetUserId: req.auth!.userId,
    tenantId: req.auth!.tenantId,
    data: {
      highValueAlertsEnabled: Boolean(nextAlerts),
      highValueAlertThreshold: nextThreshold,
      biometricEnabled: Boolean(nextBiometric),
    },
  });

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth!.userId);
  res.json(mapUserRow(updated));
});

app.post('/api/auth/biometric/toggle', requireAuth, (req: AuthedRequest, res) => {
  const user = db.prepare('SELECT biometric_enabled FROM users WHERE id = ?').get(req.auth!.userId) as { biometric_enabled?: number };
  const nextVal = typeof req.body?.enabled === 'boolean'
    ? (req.body.enabled ? 1 : 0)
    : (user?.biometric_enabled ? 0 : 1);
  db.prepare('UPDATE users SET biometric_enabled = ? WHERE id = ?').run(nextVal, req.auth!.userId);

  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: nextVal ? 'BIOMETRIC_AUTH_ENABLED' : 'BIOMETRIC_AUTH_DISABLED',
    targetType: 'USER',
    targetId: req.auth!.userId,
    metadata: `Updated TouchID/FaceID biometric preference to ${Boolean(nextVal)}`,
  });

  createNotification(
    req.auth!.userId,
    nextVal ? 'Biyometrik Doğrulama Açıldı' : 'Biyometrik Doğrulama Kapatıldı',
    nextVal
      ? 'TouchID / FaceID biyometrik kilit tercihiniz profilinize kaydedildi.'
      : 'TouchID / FaceID biyometrik kilit tercihiniz devre dışı bırakıldı.',
    'INFO'
  );
  broadcastSync({
    type: 'profile:updated',
    targetUserId: req.auth!.userId,
    tenantId: req.auth!.tenantId,
    data: { biometricEnabled: Boolean(nextVal) },
  });
  res.json({ biometricEnabled: Boolean(nextVal) });
});

// ---------- REAL-TIME SSE STREAM ----------
app.get('/api/events', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : undefined;
  const ctx = authenticateToken(token);
  if (!ctx) {
    return res.status(401).json({ error: 'Unauthorized SSE connection.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const clientId = uid('sse');
  registerSseClient({
    id: clientId,
    userId: ctx.userId,
    role: ctx.role,
    tenantId: ctx.tenantId,
    res,
  });

  const keepAlive = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      clearInterval(keepAlive);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unregisterSseClient(clientId);
  });
});

// ---------- USER-SCOPED BOOTSTRAP ----------
app.get('/api/bootstrap', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
  const accounts = (db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC').all(userId) as any[]).map(mapAccountRow);
  const cards = (db.prepare('SELECT * FROM cards WHERE user_id = ? ORDER BY created_at DESC').all(userId) as any[]).map(mapCardRow);
  const transactions = (db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(userId) as any[]).map(mapTxRow);
  const beneficiaries = (db.prepare('SELECT * FROM beneficiaries WHERE user_id = ?').all(userId) as any[]).map((b) => ({
    id: b.id,
    userId: b.user_id,
    name: b.name,
    iban: b.iban,
    bic: b.bic,
    bankName: b.bank_name,
    currency: b.currency,
    country: b.country,
    isTrusted: Boolean(b.is_trusted),
  }));
  const scheduledTransfers = db.prepare('SELECT * FROM scheduled_transfers WHERE user_id = ?').all(userId) as any[];
  const fxRates = (db.prepare('SELECT * FROM fx_rates').all() as any[]).map((r) => ({
    pair: r.pair,
    base: r.base,
    quote: r.quote,
    bid: Number(r.bid),
    ask: Number(r.ask),
    mid: Number(r.mid),
    source: r.source,
    updatedAt: r.updated_at,
  }));
  const savingsProducts = (db.prepare('SELECT * FROM savings_products').all() as any[]).map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    currency: p.currency,
    apyPercent: Number(p.apy_percent),
    termDays: p.term_days,
    minAmount: Number(p.min_amount),
    regulatoryNote: p.regulatory_note,
  }));
  const savingsPositions = (db.prepare('SELECT * FROM savings_positions WHERE user_id = ?').all(userId) as any[]).map((s) => ({
    id: s.id,
    userId: s.user_id,
    accountId: s.account_id,
    productId: s.product_id,
    productName: s.product_name,
    currency: s.currency,
    principal: Number(s.principal),
    accruedInterest: Number(s.accrued_interest),
    apyPercent: Number(s.apy_percent),
    maturityDate: s.maturity_date,
    status: s.status,
    createdAt: s.created_at,
  }));
  const loans = (db.prepare('SELECT * FROM loans WHERE user_id = ? ORDER BY created_at DESC').all(userId) as any[]).map((l) => ({
    id: l.id,
    userId: l.user_id,
    accountId: l.account_id,
    productType: l.product_type,
    principalAmount: Number(l.principal_amount),
    outstandingBalance: Number(l.outstanding_balance),
    aprPercent: Number(l.apr_percent),
    termMonths: l.term_months,
    monthlyInstallment: Number(l.monthly_installment),
    currency: l.currency,
    status: l.status,
    nextDueDate: l.next_due_date,
    fundingSource: l.funding_source,
    createdAt: l.created_at,
  }));
  const atms = (db.prepare('SELECT * FROM atms').all() as any[]).map((a) => ({
    id: a.id,
    code: a.code,
    location: a.location,
    city: a.city,
    country: a.country,
    status: a.status,
    dailyLimit: Number(a.daily_limit),
    feePercent: Number(a.fee_percent),
    supportedSchemes: JSON.parse(a.supported_schemes_json),
    lastDiagnostic: a.last_diagnostic,
  }));
  const membershipPlans = (db.prepare('SELECT * FROM membership_plans').all() as any[]).map((m) => ({
    tier: m.tier,
    monthlyPriceEur: Number(m.monthly_price_eur),
    dailyTransferLimitEur: Number(m.daily_transfer_limit_eur),
    fxMonthlyFreeAllowanceEur: Number(m.fx_monthly_free_allowance_eur),
    fxMarkupBps: m.fx_markup_bps,
    cardTierLabel: m.card_tier_label,
    supportSla: m.support_sla,
    features: JSON.parse(m.features_json),
  }));
  const notifications = (db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').all(userId) as any[]).map((n) => ({
    id: n.id,
    userId: n.user_id,
    title: n.title,
    body: n.body,
    severity: n.severity,
    isRead: Boolean(n.is_read),
    createdAt: n.created_at,
  }));
  const providers = (db.prepare('SELECT * FROM providers').all() as any[]).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    environment: p.environment,
    status: p.status,
    details: p.details,
    lastChecked: p.last_checked,
  }));
  const kycRecords = (db.prepare('SELECT * FROM kyc_kyb_records WHERE user_id = ? ORDER BY created_at DESC').all(userId) as any[]).map((k) => ({
    id: k.id,
    userId: k.user_id,
    subjectName: k.subject_name,
    recordType: k.record_type,
    documentType: k.document_type,
    documentLast4: k.document_last4,
    pepCheck: k.pep_check,
    sanctionsCheck: k.sanctions_check,
    riskScore: k.risk_score,
    status: k.status,
    reviewedBy: k.reviewed_by,
    createdAt: k.created_at,
  }));

  // Business scope
  const bizRow = db.prepare('SELECT * FROM businesses WHERE owner_user_id = ?').get(userId) as any;
  const business = bizRow
    ? {
        entity: {
          id: bizRow.id,
          ownerUserId: bizRow.owner_user_id,
          companyName: bizRow.company_name,
          registrationNumber: bizRow.registration_number,
          taxId: bizRow.tax_id,
          country: bizRow.country,
          kybStatus: bizRow.kyb_status,
          createdAt: bizRow.created_at,
        },
        members: (db.prepare('SELECT * FROM business_members WHERE business_id = ?').all(bizRow.id) as any[]).map((m) => ({
          id: m.id,
          businessId: m.business_id,
          userId: m.user_id,
          fullName: m.full_name,
          email: m.email,
          roleTitle: m.role_title,
          permissions: JSON.parse(m.permissions_json),
          approvalLimit: Number(m.approval_limit),
          status: m.status,
        })),
        invoices: (db.prepare('SELECT * FROM business_invoices WHERE business_id = ? ORDER BY created_at DESC').all(bizRow.id) as any[]).map((i) => ({
          id: i.id,
          businessId: i.business_id,
          invoiceNumber: i.invoice_number,
          clientName: i.client_name,
          clientEmail: i.client_email,
          amount: Number(i.amount),
          currency: i.currency,
          dueDate: i.due_date,
          status: i.status,
          createdAt: i.created_at,
        })),
      }
    : null;

  // Merchant & POS scope (also available for Business/Personal users granted POS permissions)
  const entitlements = getUserEntitlements(userId);
  let merRow = db.prepare('SELECT * FROM merchants WHERE user_id = ?').get(userId) as any;
  const userPosRows = db
    .prepare(
      `SELECT p.*, u.full_name as owner_name
       FROM pos_terminals p
       LEFT JOIN users u ON u.id = COALESCE(p.owner_user_id, ?)
       WHERE p.owner_user_id = ? OR p.merchant_id IN (SELECT id FROM merchants WHERE user_id = ?)
       ORDER BY p.last_heartbeat DESC`
    )
    .all(userId, userId, userId) as any[];

  if (!merRow && (entitlements.allowPosOnline || entitlements.allowPosOffline || userPosRows.length > 0)) {
    const ensured = ensureMerchantForUser(userId);
    merRow = db.prepare('SELECT * FROM merchants WHERE id = ?').get(ensured.id) as any;
  }

  const merchant = merRow
    ? {
        profile: {
          id: merRow.id,
          userId: merRow.user_id,
          businessName: merRow.business_name,
          mcc: merRow.mcc,
          country: merRow.country,
          settlementCurrency: merRow.settlement_currency,
          verificationStatus: merRow.verification_status,
          acquirerStatus: merRow.acquirer_status,
          volume30d: Number(merRow.volume_30d),
        },
        terminals: userPosRows.map(mapTerminalRow),
        paymentLinks: (db.prepare('SELECT * FROM payment_links WHERE merchant_id = ? ORDER BY created_at DESC').all(merRow.id) as any[]).map((p) => ({
          id: p.id,
          merchantId: p.merchant_id,
          title: p.title,
          amount: Number(p.amount),
          currency: p.currency,
          status: p.status,
          requires3ds: Boolean(p.requires_3ds),
          checkoutCode: p.checkout_code,
          createdAt: p.created_at,
        })),
      }
    : null;

  const offlinePosQueue = (
    db
      .prepare(
        `SELECT q.*, p.serial_number as terminal_serial, p.location_name as terminal_location
         FROM offline_pos_queue q
         LEFT JOIN pos_terminals p ON p.id = q.terminal_id
         WHERE q.owner_user_id = ?
         ORDER BY q.created_at DESC LIMIT 50`
      )
      .all(userId) as any[]
  ).map(mapOfflineQueueRow);

  const operationSettings = getSystemOperationSettings();

  const tickets = (db.prepare('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as any[]).map((t) => ({
    id: t.id,
    userId: t.user_id,
    subject: t.subject,
    category: t.category,
    channel: t.channel || 'TICKET',
    priority: t.priority,
    status: t.status,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    messages: (db.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC').all(t.id) as any[]).map((m) => ({
      id: m.id,
      ticketId: m.ticket_id,
      senderId: m.sender_id,
      senderName: m.sender_name,
      senderRole: m.sender_role,
      message: m.message,
      createdAt: m.created_at,
    })),
  }));

  const apiKeys = (db.prepare('SELECT * FROM api_keys WHERE user_id = ?').all(userId) as any[]).map((k) => ({
    id: k.id,
    userId: k.user_id,
    label: k.label,
    keyPrefix: k.key_prefix,
    environment: k.environment,
    scopes: JSON.parse(k.scopes_json),
    status: k.status,
    createdAt: k.created_at,
  }));

  const webhooks = (db.prepare('SELECT * FROM webhooks WHERE user_id = ?').all(userId) as any[]).map((w) => ({
    id: w.id,
    userId: w.user_id,
    url: w.url,
    events: JSON.parse(w.events_json),
    status: w.status,
    lastDeliveryStatus: w.last_delivery_status,
  }));

  const verifications = (
    db.prepare('SELECT * FROM identity_verifications WHERE user_id = ? ORDER BY created_at DESC').all(userId) as any[]
  ).map(mapVerificationRow);

  res.json({
    user: mapUserRow(userRow),
    accounts,
    cards,
    transactions,
    beneficiaries,
    scheduledTransfers,
    fxRates,
    savingsProducts,
    savingsPositions,
    loans,
    atms,
    membershipPlans,
    notifications,
    providers,
    kycRecords,
    verifications,
    business,
    merchant,
    offlinePosQueue,
    operationSettings,
    tickets,
    apiKeys,
    webhooks,
    isAdminUser: ADMIN_ROLES.has(req.auth!.role),
  });
});

// ---------- ACCOUNTS ----------
app.post('/api/accounts', requireAuth, (req: AuthedRequest, res) => {
  const currency = String(req.body?.currency || 'EUR').toUpperCase();
  const type = String(req.body?.type || 'MULTI_CURRENCY').toUpperCase();
  const label = String(req.body?.label || `${currency} Wallet`).trim();
  const validCurrencies = new Set(['EUR', 'USD', 'GBP', 'CHF', 'TRY', 'SAR', 'AED']);
  if (!validCurrencies.has(currency)) return res.status(400).json({ error: 'Unsupported currency.' });

  const id = uid('acc');
  const num = Math.floor(10000000 + Math.random() * 89999999);
  const countryPrefix = currency === 'TRY' ? 'TR' : currency === 'GBP' ? 'GB' : currency === 'CHF' ? 'CH' : 'DE';
  const iban = `${countryPrefix}${Math.floor(10 + Math.random() * 89)}5001051754${num}`;
  const bic = currency === 'TRY' ? 'PMNYTRISXXX' : currency === 'GBP' ? 'PMNYGB2LXXX' : 'PMNYDEFFXXX';
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO accounts (id, tenant_id, user_id, business_id, account_number, iban, bic, type, label, currency, available_balance, ledger_balance, blocked_amount, pending_amount, status, is_sandbox, created_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'ACTIVE', 1, ?)`
  ).run(id, req.auth!.tenantId, req.auth!.userId, `PM-${num}`, iban, bic, type, label, currency, now);

  createNotification(req.auth!.userId, 'New Currency Account Opened', `${label} (${currency}) opened in Sandbox Ledger.`, 'SUCCESS');
  broadcastSync({ type: 'account:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { accountId: id } });
  const created = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  res.status(201).json(mapAccountRow(created));
});

// ---------- TRANSACTIONS & TRANSFERS ----------
app.post('/api/transactions/deposit', requireAuth, (req: AuthedRequest, res) => {
  try {
    const tx = executeSandboxDeposit({
      userId: req.auth!.userId,
      accountId: String(req.body?.accountId || ''),
      amount: Number(req.body?.amount || 0),
      sourceLabel: String(req.body?.sourceLabel || 'Sandbox Bank Top-Up'),
      idempotencyKey: req.body?.idempotencyKey,
    });
    res.status(201).json(mapTxRow(tx));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/transactions/card-topup', requireAuth, (req: AuthedRequest, res) => {
  try {
    const result = executeCardTopup({
      userId: req.auth!.userId,
      accountId: String(req.body?.accountId || ''),
      amount: Number(req.body?.amount || 0),
      cardNumber: String(req.body?.cardNumber || ''),
      cardHolderName: String(req.body?.cardHolderName || ''),
      expiry: String(req.body?.expiry || ''),
      cvv: String(req.body?.cvv || ''),
      threeDsCode: String(req.body?.threeDsCode || ''),
      idempotencyKey: req.body?.idempotencyKey,
    });
    res.status(201).json({
      ...result,
      transaction: mapTxRow(result.transaction),
    });
  } catch (err: any) {
    const status = err instanceof ForbiddenError ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/transactions/transfer', requireAuth, (req: AuthedRequest, res) => {
  try {
    const tx = executeTransfer({
      userId: req.auth!.userId,
      fromAccountId: String(req.body?.fromAccountId || ''),
      recipientName: String(req.body?.recipientName || '').trim(),
      recipientIban: String(req.body?.recipientIban || '').trim(),
      bic: String(req.body?.bic || ''),
      rail: req.body?.rail || 'SEPA_TRANSFER',
      amount: Number(req.body?.amount || 0),
      reference: String(req.body?.reference || ''),
      idempotencyKey: req.body?.idempotencyKey,
    });
    res.status(201).json(mapTxRow(tx));
  } catch (err: any) {
    const status = err instanceof ForbiddenError ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/transactions/fx', requireAuth, (req: AuthedRequest, res) => {
  try {
    const result = executeFxConversion({
      userId: req.auth!.userId,
      fromAccountId: String(req.body?.fromAccountId || ''),
      toAccountId: String(req.body?.toAccountId || ''),
      fromAmount: Number(req.body?.fromAmount || 0),
      idempotencyKey: req.body?.idempotencyKey,
    });
    res.status(201).json({
      ...result,
      transaction: mapTxRow(result.transaction),
    });
  } catch (err: any) {
    const status = err instanceof ForbiddenError ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/beneficiaries', requireAuth, (req: AuthedRequest, res) => {
  const name = String(req.body?.name || '').trim();
  const iban = String(req.body?.iban || '').trim().toUpperCase();
  const bic = String(req.body?.bic || 'PMNYDEFFXXX').trim().toUpperCase();
  const bankName = String(req.body?.bankName || 'External Bank (Sandbox)').trim();
  const currency = String(req.body?.currency || 'EUR').toUpperCase();
  const country = String(req.body?.country || 'DE').toUpperCase();
  if (!name || !iban) return res.status(400).json({ error: 'Beneficiary name and IBAN are required.' });

  const id = uid('ben');
  db.prepare(
    `INSERT INTO beneficiaries (id, user_id, name, iban, bic, bank_name, currency, country, is_trusted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(id, req.auth!.userId, name, iban, bic, bankName, currency, country);
  res.status(201).json({ id, userId: req.auth!.userId, name, iban, bic, bankName, currency, country, isTrusted: true });
});

app.delete('/api/beneficiaries/:id', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM beneficiaries WHERE id = ? AND user_id = ?').run(req.params.id, req.auth!.userId);
  res.json({ ok: true });
});

app.post('/api/scheduled-transfers', requireAuth, (req: AuthedRequest, res) => {
  const id = uid('sch');
  const fromAccountId = String(req.body?.fromAccountId || '');
  const beneficiaryName = String(req.body?.beneficiaryName || '');
  const beneficiaryIban = String(req.body?.beneficiaryIban || '');
  const amount = Number(req.body?.amount || 0);
  const currency = String(req.body?.currency || 'EUR');
  const frequency = String(req.body?.frequency || 'MONTHLY');
  const nextRunDate = String(req.body?.nextRunDate || '2026-12-15');
  if (amount <= 0 || !beneficiaryName || !beneficiaryIban) return res.status(400).json({ error: 'Invalid scheduled transfer details.' });

  db.prepare(
    `INSERT INTO scheduled_transfers (id, user_id, from_account_id, beneficiary_name, beneficiary_iban, amount, currency, frequency, next_run_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`
  ).run(id, req.auth!.userId, fromAccountId, beneficiaryName, beneficiaryIban, amount, currency, frequency, nextRunDate);
  res.status(201).json({ id, fromAccountId, beneficiaryName, beneficiaryIban, amount, currency, frequency, nextRunDate, status: 'ACTIVE' });
});

// ---------- CARDS ----------
app.post('/api/cards', requireAuth, (req: AuthedRequest, res) => {
  try {
    const accountId = String(req.body?.accountId || '');
    const rawScheme = String(req.body?.scheme || 'TROY').toUpperCase();
    const scheme = (rawScheme === 'VISA' || rawScheme === 'MASTERCARD' || rawScheme === 'TROY' ? rawScheme : 'TROY') as
      | 'TROY'
      | 'VISA'
      | 'MASTERCARD';
    const productType = String(req.body?.productType || 'DEBIT').toUpperCase();
    const designVariant = String(req.body?.designVariant || 'OBSIDIAN').toUpperCase();
    const requestedCreditLimit = Number(req.body?.creditLimit || 75000);

    if (productType === 'CREDIT') {
      assertUserEntitlement(req.auth!.userId, 'allowCreditCards', 'Türk Kredi Kartı Oluşturma');
    } else {
      assertUserEntitlement(req.auth!.userId, 'allowDebitCards', 'Banka / Sanal Kart Oluşturma');
    }

    const acc = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(accountId, req.auth!.userId) as any;
    if (!acc) return res.status(404).json({ error: 'Linked account not found.' });

    const id = uid('crd');
    const generated = generateTurkishCardNumber(scheme, productType === 'CREDIT' ? 'CREDIT' : 'DEBIT');
    const now = new Date().toISOString();
    const creditLimit = productType === 'CREDIT' ? Math.max(5000, Math.min(500000, requestedCreditLimit)) : 0;
    const dailyLimit = productType === 'CREDIT' ? Math.round(creditLimit * 0.4) : 15000;
    const monthlyLimit = productType === 'CREDIT' ? creditLimit : 75000;
    const deliveryStatus =
      productType === 'VIRTUAL' ? 'Instant Virtual Active (TR BIN)' : 'Aktif & Kurye Hazırlanıyor (TR BIN)';

    db.prepare(
      `INSERT INTO cards (id, tenant_id, user_id, account_id, holder_name, pan_formatted, last4, cvv_code, issuer_label, credit_limit, expiry, scheme, product_type, design_variant, status, online_enabled, contactless_enabled, atm_enabled, daily_limit, monthly_limit, spent_today, spent_month, delivery_status, pin_hash, is_sandbox, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '11/30', ?, ?, ?, 'ACTIVE', 1, 1, 1, ?, ?, 0, 0, ?, ?, 1, ?)`
    ).run(
      id,
      req.auth!.tenantId,
      req.auth!.userId,
      acc.id,
      req.auth!.fullName.toUpperCase(),
      generated.panFormatted,
      generated.last4,
      generated.cvv,
      generated.issuerLabel,
      creditLimit,
      scheme,
      productType,
      designVariant,
      dailyLimit,
      monthlyLimit,
      deliveryStatus,
      hashPassword('1234'),
      now
    );

    createNotification(
      req.auth!.userId,
      `Yeni ${scheme} ${productType === 'CREDIT' ? 'Kredi Kartı' : productType} Oluşturuldu`,
      `${generated.issuerLabel} •••• ${generated.last4} kartınız (${acc.label}) aktif edildi.`,
      'SUCCESS'
    );
    broadcastSync({ type: 'card:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { cardId: id } });
    const created = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
    res.status(201).json(mapCardRow(created));
  } catch (err: any) {
    const status = err instanceof ForbiddenError ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/cards/:id/reveal', requireAuth, (req: AuthedRequest, res) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(req.params.id, req.auth!.userId) as any;
  if (!card) return res.status(404).json({ error: 'Kart bulunamadı veya erişim yetkiniz yok.' });

  let panFormatted = card.pan_formatted;
  let cvvCode = card.cvv_code;
  let issuerLabel = card.issuer_label;
  if (!panFormatted) {
    const scheme = (card.scheme === 'VISA' || card.scheme === 'MASTERCARD' || card.scheme === 'TROY') ? card.scheme : 'TROY';
    const gen = generateTurkishCardNumber(scheme, card.product_type === 'CREDIT' ? 'CREDIT' : 'DEBIT', card.id);
    panFormatted = gen.panFormatted;
    cvvCode = cvvCode || gen.cvv;
    issuerLabel = issuerLabel || gen.issuerLabel;
    db.prepare('UPDATE cards SET pan_formatted = ?, last4 = ?, cvv_code = ?, issuer_label = ? WHERE id = ?').run(
      panFormatted,
      gen.last4,
      cvvCode,
      issuerLabel,
      card.id
    );
  }

  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: 'CARD_PAN_REVEALED',
    targetType: 'CARD',
    targetId: card.id,
    metadata: `Revealed 16-digit PAN for card *${card.last4}`,
  });

  res.json({
    id: card.id,
    panFormatted,
    maskedPan: maskPan(panFormatted),
    cvvCode: cvvCode || '482',
    issuerLabel: issuerLabel || `PRO MONEY TR (${card.scheme})`,
    expiry: card.expiry,
    last4: panFormatted.replace(/\D/g, '').slice(-4),
    holderName: card.holder_name,
    scheme: card.scheme,
    productType: card.product_type,
  });
});

app.patch('/api/cards/:id/controls', requireAuth, (req: AuthedRequest, res) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(req.params.id, req.auth!.userId) as any;
  if (!card) return res.status(404).json({ error: 'Card not found or access denied.' });
  if (card.status === 'CANCELLED') return res.status(400).json({ error: 'Cancelled cards cannot be modified.' });

  const status = req.body?.status !== undefined ? String(req.body.status) : card.status;
  const onlineEnabled = req.body?.onlineEnabled !== undefined ? (req.body.onlineEnabled ? 1 : 0) : card.online_enabled;
  const contactlessEnabled = req.body?.contactlessEnabled !== undefined ? (req.body.contactlessEnabled ? 1 : 0) : card.contactless_enabled;
  const atmEnabled = req.body?.atmEnabled !== undefined ? (req.body.atmEnabled ? 1 : 0) : card.atm_enabled;
  const dailyLimit = req.body?.dailyLimit !== undefined ? Number(req.body.dailyLimit) : card.daily_limit;
  const monthlyLimit = req.body?.monthlyLimit !== undefined ? Number(req.body.monthlyLimit) : card.monthly_limit;

  db.prepare(
    `UPDATE cards SET status = ?, online_enabled = ?, contactless_enabled = ?, atm_enabled = ?, daily_limit = ?, monthly_limit = ? WHERE id = ?`
  ).run(status, onlineEnabled, contactlessEnabled, atmEnabled, dailyLimit, monthlyLimit, card.id);

  if (req.body?.newPin && /^\d{4}$/.test(String(req.body.newPin))) {
    db.prepare('UPDATE cards SET pin_hash = ? WHERE id = ?').run(hashPassword(String(req.body.newPin)), card.id);
  }

  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: 'CARD_CONTROLS_UPDATED',
    targetType: 'CARD',
    targetId: card.id,
    metadata: `Status=${status}, Online=${onlineEnabled}, Contactless=${contactlessEnabled}, ATM=${atmEnabled}, DailyLimit=${dailyLimit}`,
  });

  broadcastSync({ type: 'card:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { cardId: card.id, status } });
  const updated = db.prepare('SELECT * FROM cards WHERE id = ?').get(card.id);
  res.json(mapCardRow(updated));
});

// ---------- ATM SANDBOX WITHDRAWAL ----------
app.post('/api/atms/withdraw', requireAuth, (req: AuthedRequest, res) => {
  try {
    const atmId = String(req.body?.atmId || '');
    const cardId = String(req.body?.cardId || '');
    const amount = Number(req.body?.amount || 0);

    const atm = db.prepare('SELECT * FROM atms WHERE id = ?').get(atmId) as any;
    const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(cardId, req.auth!.userId) as any;
    if (!atm || !card) return res.status(404).json({ error: 'ATM or card not found.' });
    if (card.status !== 'ACTIVE' || !card.atm_enabled) return res.status(400).json({ error: 'Card is frozen or ATM withdrawals disabled.' });
    if (amount <= 0 || amount > atm.daily_limit) return res.status(400).json({ error: 'Amount exceeds ATM withdrawal limit.' });

    const tx = executeTransfer({
      userId: req.auth!.userId,
      fromAccountId: card.account_id,
      recipientName: `ATM ${atm.code} · ${atm.city}`,
      recipientIban: `ATM-${atm.code}`,
      rail: 'WITHDRAWAL',
      amount,
      reference: `ATM Withdrawal (${card.scheme} *${card.last4})`,
    });
    res.status(201).json(mapTxRow(tx));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- SAVINGS & LOANS ----------
app.post('/api/savings/open', requireAuth, (req: AuthedRequest, res) => {
  const productId = String(req.body?.productId || '');
  const fromAccountId = String(req.body?.fromAccountId || '');
  const amount = Number(req.body?.amount || 0);

  const product = db.prepare('SELECT * FROM savings_products WHERE id = ?').get(productId) as any;
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(fromAccountId, req.auth!.userId) as any;
  if (!product || !account) return res.status(404).json({ error: 'Product or source account not found.' });
  if (account.currency !== product.currency) return res.status(400).json({ error: `Please fund from a ${product.currency} account.` });
  if (amount < product.min_amount) return res.status(400).json({ error: `Minimum deposit is ${product.min_amount} ${product.currency}.` });
  if (account.available_balance < amount) return res.status(400).json({ error: 'Insufficient balance.' });

  const posId = uid('savp');
  const now = new Date().toISOString();
  const maturity = product.term_days > 0 ? new Date(Date.now() + product.term_days * 86400000).toISOString().slice(0, 10) : null;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE accounts SET available_balance = ROUND(available_balance - ?, 2), ledger_balance = ROUND(ledger_balance - ?, 2) WHERE id = ?`
    ).run(amount, amount, account.id);

    db.prepare(
      `INSERT INTO savings_positions (id, user_id, account_id, product_id, product_name, currency, principal, accrued_interest, apy_percent, maturity_date, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'ACTIVE', ?)`
    ).run(posId, req.auth!.userId, account.id, product.id, product.name, product.currency, amount, product.apy_percent, maturity, now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcastSync({ type: 'account:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { posId } });
  res.status(201).json({ id: posId, status: 'ACTIVE' });
});

app.post('/api/savings/:id/withdraw', requireAuth, (req: AuthedRequest, res) => {
  const pos = db.prepare('SELECT * FROM savings_positions WHERE id = ? AND user_id = ?').get(req.params.id, req.auth!.userId) as any;
  if (!pos || pos.status !== 'ACTIVE') return res.status(404).json({ error: 'Active savings position not found.' });
  const payout = Number((pos.principal + pos.accrued_interest).toFixed(2));

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE accounts SET available_balance = ROUND(available_balance + ?, 2), ledger_balance = ROUND(ledger_balance + ?, 2) WHERE id = ?`
    ).run(payout, payout, pos.account_id);
    db.prepare(`UPDATE savings_positions SET status = 'CLOSED' WHERE id = ?`).run(pos.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcastSync({ type: 'account:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { posId: pos.id } });
  res.json({ ok: true, payout });
});

app.post('/api/loans/apply', requireAuth, (req: AuthedRequest, res) => {
  try {
    assertUserEntitlement(req.auth!.userId, 'allowLoans', 'Kredi Başvurusu & Finansman');
    const loanOp = getOperationSetting('LOANS');
    if (loanOp && !loanOp.enabled) {
      return res.status(403).json({ error: 'Yetki izniniz yoktur: Kredi başvuruları yönetim tarafından geçici olarak kapatılmıştır.' });
    }
  } catch (err: any) {
    return res.status(403).json({ error: err.message });
  }
  const accountId = String(req.body?.accountId || '');
  const productType = String(req.body?.productType || 'PERSONAL_LOAN');
  const amount = Number(req.body?.amount || 0);
  const termMonths = Math.max(3, Math.min(60, Number(req.body?.termMonths || 12)));
  const monthlyIncome = Number(req.body?.monthlyIncome || 0);

  const acc = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(accountId, req.auth!.userId) as any;
  if (!acc) return res.status(404).json({ error: 'Target account not found.' });
  if (amount < 500 || amount > 100000) return res.status(400).json({ error: 'Sandbox loan range is 500 to 100,000.' });
  if (monthlyIncome <= 0) return res.status(400).json({ error: 'Declared monthly income is required for credit assessment.' });

  const apr = productType === 'BUSINESS_LOAN' ? 7.4 : 8.9;
  const r = apr / 100 / 12;
  const monthlyInstallment = Number(((amount * r) / (1 - Math.pow(1 + r, -termMonths))).toFixed(2));
  const id = uid('loan');
  const now = new Date().toISOString();
  const nextDue = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  // Underwriting ratio check: never auto-disburse without licensed lender, mark UNDER_REVIEW
  db.prepare(
    `INSERT INTO loans (id, user_id, account_id, product_type, principal_amount, outstanding_balance, apr_percent, term_months, monthly_installment, currency, status, next_due_date, funding_source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNDER_REVIEW', ?, 'Pool E — Segregated Credit Facility (Requires Licensed Lender)', ?)`
  ).run(id, req.auth!.userId, acc.id, productType, amount, amount, apr, termMonths, monthlyInstallment, acc.currency, nextDue, now);

  createNotification(req.auth!.userId, 'Loan Application Submitted', `${productType} request for ${amount} ${acc.currency} queued for licensed underwriter review.`, 'INFO');
  broadcastSync({ type: 'admin:sync', tenantId: req.auth!.tenantId, data: { loanId: id } });
  res.status(201).json({ id, status: 'UNDER_REVIEW', monthlyInstallment });
});

app.post('/api/loans/:id/repay', requireAuth, (req: AuthedRequest, res) => {
  const loan = db.prepare('SELECT * FROM loans WHERE id = ? AND user_id = ?').get(req.params.id, req.auth!.userId) as any;
  if (!loan || loan.outstanding_balance <= 0) return res.status(404).json({ error: 'Active loan not found.' });
  const amount = Math.min(loan.outstanding_balance, Number(req.body?.amount || loan.monthly_installment));
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(loan.account_id, req.auth!.userId) as any;
  if (!acc || acc.available_balance < amount) return res.status(400).json({ error: 'Insufficient funds for installment repayment.' });

  const newBal = Number((loan.outstanding_balance - amount).toFixed(2));
  const nextStatus = newBal <= 0 ? 'REPAID' : loan.status;
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE accounts SET available_balance = ROUND(available_balance - ?, 2), ledger_balance = ROUND(ledger_balance - ?, 2) WHERE id = ?`).run(amount, amount, acc.id);
    db.prepare(`UPDATE central_fund_pools SET balance = ROUND(balance + ?, 2), updated_at = ? WHERE id = 'pool_E'`).run(amount, now);
    db.prepare(`UPDATE loans SET outstanding_balance = ?, status = ? WHERE id = ?`).run(newBal, nextStatus, loan.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcastSync({ type: 'account:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { loanId: loan.id } });
  res.json({ outstandingBalance: newBal, status: nextStatus });
});

// ---------- KYC / KYB ----------
app.post('/api/kyc/submit', requireAuth, (req: AuthedRequest, res) => {
  const documentType = String(req.body?.documentType || 'National Passport');
  const documentLast4 = String(req.body?.documentLast4 || '0000').slice(-4);
  const recordType = req.body?.recordType === 'KYB' ? 'KYB' : 'KYC';
  const id = uid('kyc');
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO kyc_kyb_records (id, user_id, subject_name, record_type, document_type, document_last4, pep_check, sanctions_check, risk_score, status, reviewed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'CLEAR', 'CLEAR', 15, 'PENDING', NULL, ?)`
  ).run(id, req.auth!.userId, req.auth!.fullName, recordType, documentType, documentLast4, now);

  db.prepare(`UPDATE users SET kyc_status = 'PENDING' WHERE id = ?`).run(req.auth!.userId);
  broadcastSync({ type: 'compliance:updated', tenantId: req.auth!.tenantId, targetUserId: req.auth!.userId, data: { kycId: id } });
  res.status(201).json({ id, status: 'PENDING' });
});

// ---------- 4-PILLAR VERIFICATIONS (IDENTITY, PASSPORT, ADDRESS, PHONE OTP) ----------
app.post('/api/verifications/submit', requireAuth, (req: AuthedRequest, res) => {
  const rawType = String(req.body?.verificationType || '').toUpperCase();
  if (!['IDENTITY_CARD', 'PASSPORT', 'ADDRESS'].includes(rawType)) {
    return res.status(400).json({ error: 'Invalid verification type. Choose IDENTITY_CARD, PASSPORT, or ADDRESS.' });
  }
  const verificationType = rawType as 'IDENTITY_CARD' | 'PASSPORT' | 'ADDRESS';
  const documentNumber = String(req.body?.documentNumber || '').trim() || null;
  const issuingCountry = String(req.body?.issuingCountry || 'TR').trim().toUpperCase();
  const expiryDate = String(req.body?.expiryDate || '').trim() || null;
  const addressFull = String(req.body?.addressFull || '').trim() || null;
  const city = String(req.body?.city || '').trim() || null;
  const postalCode = String(req.body?.postalCode || '').trim() || null;
  const proofReference = String(req.body?.proofReference || '').trim() || null;

  if (verificationType === 'IDENTITY_CARD' && (!documentNumber || documentNumber.length < 5)) {
    return res.status(400).json({ error: 'Valid National ID / T.C. Kimlik number is required.' });
  }
  if (verificationType === 'PASSPORT' && (!documentNumber || documentNumber.length < 5)) {
    return res.status(400).json({ error: 'Valid Passport number is required.' });
  }
  if (verificationType === 'ADDRESS' && (!addressFull || addressFull.length < 6 || !city)) {
    return res.status(400).json({ error: 'Full street address and city are required.' });
  }

  const id = uid('ver');
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO identity_verifications (
         id, user_id, verification_type, document_number, issuing_country, expiry_date,
         address_full, city, postal_code, proof_reference, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`
    ).run(id, req.auth!.userId, verificationType, documentNumber, issuingCountry, expiryDate, addressFull, city, postalCode, proofReference, now);

    if (verificationType === 'IDENTITY_CARD') {
      db.prepare(`UPDATE users SET national_id_number = ?, identity_verified = 0, kyc_status = 'PENDING' WHERE id = ?`).run(
        documentNumber,
        req.auth!.userId
      );
    } else if (verificationType === 'PASSPORT') {
      db.prepare(`UPDATE users SET passport_number = ?, passport_verified = 0, kyc_status = 'PENDING' WHERE id = ?`).run(
        documentNumber,
        req.auth!.userId
      );
    } else if (verificationType === 'ADDRESS') {
      db.prepare(`UPDATE users SET address_line = ?, city = ?, postal_code = ?, address_verified = 0, kyc_status = 'PENDING' WHERE id = ?`).run(
        addressFull,
        city,
        postalCode,
        req.auth!.userId
      );
    }

    writeAuditLog({
      actorUserId: req.auth!.userId,
      actorEmail: req.auth!.email,
      actorRole: req.auth!.role,
      action: `VERIFICATION_SUBMITTED_${verificationType}`,
      targetType: 'VERIFICATION',
      targetId: id,
      metadata: `Submitted ${verificationType} verification for Compliance review`,
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcastSync({ type: 'compliance:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { verificationId: id } });
  const row = db.prepare('SELECT * FROM identity_verifications WHERE id = ?').get(id);
  res.status(201).json(mapVerificationRow(row));
});

app.post('/api/verifications/phone/send-otp', requireAuth, (req: AuthedRequest, res) => {
  const userRow = db.prepare('SELECT phone FROM users WHERE id = ?').get(req.auth!.userId) as { phone: string } | undefined;
  const phoneNumber = String(req.body?.phoneNumber || userRow?.phone || '').trim();
  if (normalizeDigits(phoneNumber).length < 7) {
    return res.status(400).json({ error: 'Valid mobile phone number is required.' });
  }

  const otpCode = String(crypto.randomInt(100000, 999999));
  const challengeId = uid('otp');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO phone_otp_challenges (id, user_id, phone_number, code_hash, expires_at, verified, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(challengeId, req.auth!.userId, phoneNumber, hashToken(otpCode), expiresAt, now.toISOString());

  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: 'PHONE_OTP_ISSUED',
    targetType: 'OTP_CHALLENGE',
    targetId: challengeId,
    metadata: `Issued Sandbox SMS OTP to ${phoneNumber}`,
  });

  res.status(201).json({
    challengeId,
    phoneNumber,
    expiresAt,
    sandboxOtpCode: otpCode,
  });
});

app.post('/api/verifications/phone/verify-otp', requireAuth, (req: AuthedRequest, res) => {
  const challengeId = String(req.body?.challengeId || '').trim();
  const code = String(req.body?.code || '').trim();
  if (!challengeId || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Challenge ID and 6-digit SMS code are required.' });
  }

  const challenge = db
    .prepare('SELECT * FROM phone_otp_challenges WHERE id = ? AND user_id = ?')
    .get(challengeId, req.auth!.userId) as any;

  if (!challenge) return res.status(404).json({ error: 'OTP challenge not found.' });
  if (challenge.verified === 1) return res.status(400).json({ error: 'OTP code already used.' });
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'OTP code expired. Please request a new code.' });
  }
  if (challenge.code_hash !== hashToken(code)) {
    return res.status(400).json({ error: 'Invalid SMS verification code.' });
  }

  const verId = uid('ver');
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE phone_otp_challenges SET verified = 1 WHERE id = ?').run(challenge.id);
    db.prepare('UPDATE users SET phone = ?, phone_verified = 1 WHERE id = ?').run(challenge.phone_number, req.auth!.userId);
    db.prepare(
      `INSERT INTO identity_verifications (
         id, user_id, verification_type, phone_number, proof_reference, status, verified_by, verified_at, created_at
       ) VALUES (?, ?, 'PHONE', ?, ?, 'VERIFIED', 'SMS_OTP_SYSTEM', ?, ?)`
    ).run(verId, req.auth!.userId, challenge.phone_number, `OTP-${challenge.id}`, now, now);

    const updatedUser = db
      .prepare('SELECT identity_verified, passport_verified, address_verified, phone_verified FROM users WHERE id = ?')
      .get(req.auth!.userId) as any;
    if ((updatedUser.identity_verified || updatedUser.passport_verified) && updatedUser.address_verified && updatedUser.phone_verified) {
      db.prepare(`UPDATE users SET kyc_status = 'VERIFIED' WHERE id = ?`).run(req.auth!.userId);
    }

    writeAuditLog({
      actorUserId: req.auth!.userId,
      actorEmail: req.auth!.email,
      actorRole: req.auth!.role,
      action: 'PHONE_NUMBER_VERIFIED',
      targetType: 'VERIFICATION',
      targetId: verId,
      metadata: `Verified phone ${challenge.phone_number} via SMS OTP`,
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  createNotification(req.auth!.userId, 'Phone Number Verified', `Mobile number ${challenge.phone_number} verified via SMS OTP.`, 'SUCCESS');
  broadcastSync({ type: 'profile:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { phoneVerified: true } });
  res.json({ ok: true, phoneNumber: challenge.phone_number, verificationId: verId });
});

// ---------- BUSINESS BANKING ----------
app.post('/api/business/members', requireAuth, (req: AuthedRequest, res) => {
  const biz = db.prepare('SELECT * FROM businesses WHERE owner_user_id = ?').get(req.auth!.userId) as any;
  if (!biz) return res.status(403).json({ error: 'Business profile required.' });
  const id = uid('bm');
  const fullName = String(req.body?.fullName || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const roleTitle = String(req.body?.roleTitle || 'Analyst').trim();
  const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions : ['VIEW_ACCOUNTS'];
  const approvalLimit = Number(req.body?.approvalLimit || 2500);
  if (!fullName || !email) return res.status(400).json({ error: 'Name and email required.' });

  db.prepare(
    `INSERT INTO business_members (id, business_id, user_id, full_name, email, role_title, permissions_json, approval_limit, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`
  ).run(id, biz.id, uid('emp'), fullName, email, roleTitle, JSON.stringify(permissions), approvalLimit);
  res.status(201).json({ id, fullName, email, roleTitle, permissions, approvalLimit, status: 'ACTIVE' });
});

app.post('/api/business/invoices', requireAuth, (req: AuthedRequest, res) => {
  const biz = db.prepare('SELECT * FROM businesses WHERE owner_user_id = ?').get(req.auth!.userId) as any;
  if (!biz) return res.status(403).json({ error: 'Business profile required.' });
  const id = uid('inv');
  const invoiceNumber = `INV-2026-${Math.floor(100 + Math.random() * 899)}`;
  const clientName = String(req.body?.clientName || '').trim();
  const clientEmail = String(req.body?.clientEmail || '').trim();
  const amount = Number(req.body?.amount || 0);
  const currency = String(req.body?.currency || 'EUR');
  const dueDate = String(req.body?.dueDate || '2026-12-30');
  if (!clientName || amount <= 0) return res.status(400).json({ error: 'Client name and positive amount required.' });

  db.prepare(
    `INSERT INTO business_invoices (id, business_id, invoice_number, client_name, client_email, amount, currency, due_date, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SENT', ?)`
  ).run(id, biz.id, invoiceNumber, clientName, clientEmail, amount, currency, dueDate, new Date().toISOString());
  res.status(201).json({ id, invoiceNumber, clientName, clientEmail, amount, currency, dueDate, status: 'SENT' });
});

// ---------- MERCHANT & POS (ONLINE + OFFLINE + ADMIN APPROVAL) ----------
app.post('/api/merchant/terminals', requireAuth, (req: AuthedRequest, res) => {
  const entitlements = getUserEntitlements(req.auth!.userId);
  if (!entitlements.allowPosOnline && !entitlements.allowPosOffline) {
    return res.status(403).json({
      error: 'Yetki izniniz yoktur: POS cihazı talep etmek için Online POS veya Offline POS yetkisi yönetim tarafından tanımlanmalıdır.',
    });
  }

  const mer = ensureMerchantForUser(req.auth!.userId);
  const id = uid('pos');
  const serial = `PM-POS-${Math.floor(100000 + Math.random() * 899999)}`;
  const model = String(req.body?.model || 'PRO MONEY Terminal X2 (EMV/NFC)');
  const locationName = String(req.body?.locationName || 'Ana Kasa').trim();
  const requestedModeRaw = String(req.body?.terminalMode || 'HYBRID').toUpperCase();
  const terminalMode = (['ONLINE', 'OFFLINE', 'HYBRID'].includes(requestedModeRaw) ? requestedModeRaw : 'HYBRID') as
    | 'ONLINE'
    | 'OFFLINE'
    | 'HYBRID';
  const requestedFloor = Math.max(500, Math.min(50000, Number(req.body?.offlineFloorLimit || 5000)));
  const now = new Date().toISOString();

  // Only Admin users get pre-approved; all other accounts require Management approval!
  const isAdmin = ADMIN_ROLES.has(req.auth!.role);
  const approvalStatus = isAdmin ? 'APPROVED' : 'PENDING_APPROVAL';
  const onlineEnabled = isAdmin && terminalMode !== 'OFFLINE' ? 1 : 0;
  const offlineEnabled = isAdmin && terminalMode !== 'ONLINE' ? 1 : 0;
  const status = isAdmin ? (onlineEnabled ? 'ONLINE_SANDBOX' : 'OFFLINE') : 'OFFLINE';

  db.prepare(
    `INSERT INTO pos_terminals (
       id, merchant_id, owner_user_id, serial_number, model, location_name, status,
       terminal_mode, approval_status, online_enabled, offline_enabled, offline_floor_limit,
       offline_queued_count, offline_queued_amount, approved_by, approved_at,
       supports_contactless, supports_qr, supports_offline_rules, last_heartbeat
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 1, 1, ?, ?)`
  ).run(
    id,
    mer.id,
    req.auth!.userId,
    serial,
    model,
    locationName,
    status,
    terminalMode,
    approvalStatus,
    onlineEnabled,
    offlineEnabled,
    requestedFloor,
    isAdmin ? req.auth!.userId : null,
    isAdmin ? now : null,
    terminalMode !== 'ONLINE' ? 1 : 0,
    now
  );

  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: 'POS_TERMINAL_REQUESTED',
    targetType: 'POS_TERMINAL',
    targetId: id,
    metadata: `Serial=${serial}, Mode=${terminalMode}, Approval=${approvalStatus}`,
  });

  createNotification(
    req.auth!.userId,
    isAdmin ? 'POS Cihazı Aktif Edildi' : 'POS Cihazı Talebi Alındı',
    isAdmin
      ? `${serial} (${terminalMode}) cihazınız aktif edildi.`
      : `${serial} (${terminalMode}) POS cihazı talebiniz Yönetim onayına gönderildi. Onay sonrası açılacaktır.`,
    isAdmin ? 'SUCCESS' : 'INFO'
  );

  broadcastSync({ type: 'pos:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { terminalId: id } });
  broadcastSync({ type: 'admin:sync', tenantId: req.auth!.tenantId, data: { event: 'POS_REQUESTED', terminalId: id } });

  const created = db.prepare('SELECT * FROM pos_terminals WHERE id = ?').get(id);
  res.status(201).json(mapTerminalRow(created));
});

app.post('/api/merchant/pos-collect', requireAuth, (req: AuthedRequest, res) => {
  const entitlements = getUserEntitlements(req.auth!.userId);
  const amount = Number(req.body?.amount || 0);
  const method = String(req.body?.method || 'CONTACTLESS');
  const mode = String(req.body?.mode || 'ONLINE').toUpperCase() === 'OFFLINE' ? 'OFFLINE' : 'ONLINE';
  const terminalId = String(req.body?.terminalId || '');
  const cardLast4 = String(req.body?.cardLast4 || '6010').replace(/\D/g, '').slice(-4) || '6010';
  const cardScheme = String(req.body?.cardScheme || 'TROY').toUpperCase();
  if (amount <= 0) return res.status(400).json({ error: 'Tahsilat tutarı sıfırdan büyük olmalıdır.' });

  const terminal = terminalId
    ? (db
        .prepare(
          `SELECT p.* FROM pos_terminals p
           LEFT JOIN merchants m ON m.id = p.merchant_id
           WHERE p.id = ? AND (p.owner_user_id = ? OR m.user_id = ?)`
        )
        .get(terminalId, req.auth!.userId, req.auth!.userId) as any)
    : (db
        .prepare(
          `SELECT p.* FROM pos_terminals p
           LEFT JOIN merchants m ON m.id = p.merchant_id
           WHERE (p.owner_user_id = ? OR m.user_id = ?) AND p.approval_status = 'APPROVED'
           ORDER BY p.last_heartbeat DESC LIMIT 1`
        )
        .get(req.auth!.userId, req.auth!.userId) as any);

  if (!terminal) {
    return res.status(404).json({ error: 'Size tanımlı POS cihazı bulunamadı. Önce POS cihazı talep edin.' });
  }
  if (terminal.approval_status !== 'APPROVED') {
    return res.status(403).json({
      error: 'Yetki izniniz yoktur: Bu POS cihazı henüz Yönetim tarafından onaylanmadığı için tahsilata kapalıdır.',
    });
  }

  const mer = ensureMerchantForUser(req.auth!.userId);
  const merchantAccount = db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC LIMIT 1').get(req.auth!.userId) as any;
  if (!merchantAccount) return res.status(404).json({ error: 'Tahsilatların aktarılacağı hesap bulunamadı.' });

  if (mode === 'OFFLINE') {
    if (!entitlements.allowPosOffline) {
      return res.status(403).json({ error: 'Yetki izniniz yoktur: Offline POS tahsilat yetkiniz kapalıdır.' });
    }
    const offOp = getOperationSetting('POS_OFFLINE');
    if (offOp && !offOp.enabled) {
      return res.status(403).json({ error: 'Yetki izniniz yoktur: Offline POS sistemi yönetim tarafından kapatılmıştır.' });
    }
    if (!terminal.offline_enabled) {
      return res.status(403).json({ error: 'Yetki izniniz yoktur: Seçili POS cihazında Offline mod Yönetim tarafından açılmamıştır.' });
    }
    const floorLimit = Number(terminal.offline_floor_limit || 2500);
    if (amount > floorLimit) {
      return res.status(400).json({
        error: `Offline POS tek işlem limiti (${floorLimit.toLocaleString('tr-TR')} ${merchantAccount.currency}) aşıldı. Online POS kullanın.`,
      });
    }

    const qId = uid('opq');
    const now = new Date().toISOString();
    const ref = `OFF-${method}-${Math.floor(10000 + Math.random() * 89999)}`;
    const authCode = `OFF-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO offline_pos_queue (id, terminal_id, merchant_id, owner_user_id, amount, currency, card_last4, card_scheme, reference, auth_code, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED_OFFLINE', ?)`
      ).run(qId, terminal.id, mer.id, req.auth!.userId, amount, merchantAccount.currency, cardLast4, cardScheme, ref, authCode, now);

      db.prepare(
        `UPDATE pos_terminals
         SET offline_queued_count = offline_queued_count + 1,
             offline_queued_amount = ROUND(offline_queued_amount + ?, 2),
             last_heartbeat = ?
         WHERE id = ?`
      ).run(amount, now, terminal.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    broadcastSync({ type: 'pos:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { queueId: qId, mode: 'OFFLINE' } });
    return res.status(201).json({
      queuedOffline: true,
      queueId: qId,
      authCode,
      reference: ref,
      amount,
      currency: merchantAccount.currency,
      terminalSerial: terminal.serial_number,
    });
  }

  // ONLINE POS collection
  if (!entitlements.allowPosOnline) {
    return res.status(403).json({ error: 'Yetki izniniz yoktur: Online POS tahsilat yetkiniz kapalıdır.' });
  }
  const onOp = getOperationSetting('POS_ONLINE');
  if (onOp && !onOp.enabled) {
    return res.status(403).json({ error: 'Yetki izniniz yoktur: Online POS sistemi yönetim tarafından kapatılmıştır.' });
  }
  if (!terminal.online_enabled) {
    return res.status(403).json({ error: 'Yetki izniniz yoktur: Seçili POS cihazında Online mod Yönetim tarafından açılmamıştır.' });
  }

  const feeFixed = onOp ? Number(onOp.fee_fixed) : 0;
  const feePercent = onOp ? Number(onOp.fee_percent) : 1.49;
  const fee = Number((feeFixed + (amount * feePercent) / 100).toFixed(2));
  const net = Number((amount - fee).toFixed(2));
  const txId = uid('tx');
  const now = new Date().toISOString();
  const ref = `POS-${method}-${Math.floor(10000 + Math.random() * 89999)}`;

  const posClearingPool = getPrimaryClearingPool('IN');

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO transactions (id, idempotency_key, tenant_id, user_id, from_account_id, to_account_id, counterparty_name, counterparty_iban, type, category, amount, fee, currency, direction, status, reference, source, authorization_code, is_sandbox, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'POS_PAYMENT', 'Merchant Sales', ?, ?, ?, 'IN', 'COMPLETED', ?, ?, ?, 1, ?)`
    ).run(
      txId,
      uid('idem'),
      merchantAccount.tenant_id,
      req.auth!.userId,
      merchantAccount.id,
      `Online POS ${method} (${terminal.serial_number})`,
      posClearingPool.iban || `POS-ACQUIRER-${posClearingPool.code}`,
      net,
      fee,
      merchantAccount.currency,
      ref,
      'POS_ONLINE_ACQUIRER',
      `POS-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      now
    );

    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
       VALUES (?, ?, NULL, ?, 'DEBIT', ?, ?, ?, ?)`
    ).run(uid('ldg'), txId, posClearingPool.id, amount, merchantAccount.currency, `POS gross clearing via Pool ${posClearingPool.code} (${ref})`, now);

    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
       VALUES (?, ?, ?, NULL, 'CREDIT', ?, ?, ?, ?)`
    ).run(uid('ldg'), txId, merchantAccount.id, net, merchantAccount.currency, `Merchant net settlement (${ref})`, now);

    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
       VALUES (?, ?, NULL, 'pool_G', 'CREDIT', ?, ?, ?, ?)`
    ).run(uid('ldg'), txId, fee, merchantAccount.currency, `Merchant acquiring MDR fee (${ref})`, now);

    db.prepare(`UPDATE central_fund_pools SET balance = ROUND(balance - ?, 2), updated_at = ? WHERE id = ?`).run(amount, now, posClearingPool.id);
    db.prepare(`UPDATE central_fund_pools SET balance = ROUND(balance + ?, 2), updated_at = ? WHERE id = 'pool_G'`).run(fee, now);
    db.prepare(`UPDATE accounts SET available_balance = ROUND(available_balance + ?, 2), ledger_balance = ROUND(ledger_balance + ?, 2) WHERE id = ?`).run(
      net,
      net,
      merchantAccount.id
    );
    db.prepare(`UPDATE merchants SET volume_30d = ROUND(volume_30d + ?, 2) WHERE id = ?`).run(amount, mer.id);
    db.prepare(`UPDATE pos_terminals SET last_heartbeat = ? WHERE id = ?`).run(now, terminal.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  maybeEmitHighValueAlert({
    userId: req.auth!.userId,
    tenantId: merchantAccount.tenant_id,
    txId,
    amount,
    currency: merchantAccount.currency,
    counterpartyName: `Online POS ${method} (${terminal.serial_number})`,
    typeLabel: 'POS Payment',
  });
  broadcastSync({ type: 'pos:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { txId } });
  broadcastSync({ type: 'account:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { txId } });
  res.status(201).json({ queuedOffline: false, txId, net, fee, currency: merchantAccount.currency });
});

app.post('/api/pos/offline-sync', requireAuth, (req: AuthedRequest, res) => {
  const entitlements = getUserEntitlements(req.auth!.userId);
  if (!entitlements.allowPosOffline && !entitlements.allowPosOnline) {
    return res.status(403).json({ error: 'Yetki izniniz yoktur: Offline POS senkronizasyon yetkiniz kapalıdır.' });
  }

  const terminalIdFilter = req.body?.terminalId ? String(req.body.terminalId) : null;
  const queuedItems = (
    terminalIdFilter
      ? db
          .prepare(
            `SELECT q.* FROM offline_pos_queue q
             JOIN pos_terminals p ON p.id = q.terminal_id
             WHERE q.owner_user_id = ? AND q.terminal_id = ? AND q.status = 'QUEUED_OFFLINE' AND p.approval_status = 'APPROVED'`
          )
          .all(req.auth!.userId, terminalIdFilter)
      : db
          .prepare(
            `SELECT q.* FROM offline_pos_queue q
             JOIN pos_terminals p ON p.id = q.terminal_id
             WHERE q.owner_user_id = ? AND q.status = 'QUEUED_OFFLINE' AND p.approval_status = 'APPROVED'`
          )
          .all(req.auth!.userId)
  ) as any[];

  if (queuedItems.length === 0) {
    return res.json({ settledCount: 0, totalNet: 0, totalFee: 0 });
  }

  const merchantAccount = db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC LIMIT 1').get(req.auth!.userId) as any;
  if (!merchantAccount) return res.status(404).json({ error: 'Settlement account not found.' });

  const offOp = getOperationSetting('POS_OFFLINE');
  const feeFixed = offOp ? Number(offOp.fee_fixed) : 0;
  const feePercent = offOp ? Number(offOp.fee_percent) : 1.75;
  const now = new Date().toISOString();

  let totalNet = 0;
  let totalFee = 0;

  const posOfflinePool = getPrimaryClearingPool('IN');

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of queuedItems) {
      const fee = Number((feeFixed + (item.amount * feePercent) / 100).toFixed(2));
      const net = Number((item.amount - fee).toFixed(2));
      totalNet = Number((totalNet + net).toFixed(2));
      totalFee = Number((totalFee + fee).toFixed(2));
      const txId = uid('tx');

      db.prepare(
        `INSERT INTO transactions (id, idempotency_key, tenant_id, user_id, from_account_id, to_account_id, counterparty_name, counterparty_iban, type, category, amount, fee, currency, direction, status, reference, source, authorization_code, is_sandbox, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'POS_PAYMENT', 'Offline POS Settlement', ?, ?, ?, 'IN', 'COMPLETED', ?, ?, ?, 1, ?)`
      ).run(
        txId,
        `offsync_${item.id}`,
        merchantAccount.tenant_id,
        req.auth!.userId,
        merchantAccount.id,
        `Offline POS Sync (${item.card_scheme} *${item.card_last4})`,
        posOfflinePool.iban || `POS-OFFLINE-${posOfflinePool.code}`,
        net,
        fee,
        merchantAccount.currency,
        item.reference,
        'POS_OFFLINE_SYNC',
        item.auth_code,
        now
      );

      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
         VALUES (?, ?, NULL, ?, 'DEBIT', ?, ?, ?, ?)`
      ).run(uid('ldg'), txId, posOfflinePool.id, item.amount, merchantAccount.currency, `Offline POS clearing Pool ${posOfflinePool.code} (${item.reference})`, now);

      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
         VALUES (?, ?, ?, NULL, 'CREDIT', ?, ?, ?, ?)`
      ).run(uid('ldg'), txId, merchantAccount.id, net, merchantAccount.currency, `Offline POS net settlement (${item.reference})`, now);

      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
         VALUES (?, ?, NULL, 'pool_G', 'CREDIT', ?, ?, ?, ?)`
      ).run(uid('ldg'), txId, fee, merchantAccount.currency, `Offline POS acquiring MDR fee (${item.reference})`, now);

      db.prepare(`UPDATE central_fund_pools SET balance = ROUND(balance - ?, 2), updated_at = ? WHERE id = ?`).run(item.amount, now, posOfflinePool.id);
      db.prepare(`UPDATE central_fund_pools SET balance = ROUND(balance + ?, 2), updated_at = ? WHERE id = 'pool_G'`).run(fee, now);
      db.prepare(
        `UPDATE accounts SET available_balance = ROUND(available_balance + ?, 2), ledger_balance = ROUND(ledger_balance + ?, 2) WHERE id = ?`
      ).run(net, net, merchantAccount.id);
      db.prepare(`UPDATE merchants SET volume_30d = ROUND(volume_30d + ?, 2) WHERE id = ?`).run(item.amount, item.merchant_id);
      db.prepare(`UPDATE offline_pos_queue SET status = 'SETTLED', settled_at = ? WHERE id = ?`).run(now, item.id);
      db.prepare(
        `UPDATE pos_terminals
         SET offline_queued_count = MAX(0, offline_queued_count - 1),
             offline_queued_amount = MAX(0, ROUND(offline_queued_amount - ?, 2)),
             last_heartbeat = ?
         WHERE id = ?`
      ).run(item.amount, now, item.terminal_id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  createNotification(
    req.auth!.userId,
    'Offline POS İşlemleri Senkronize Edildi',
    `${queuedItems.length} adet çevrimdışı POS işlemi (${totalNet.toFixed(2)} ${merchantAccount.currency} net) hesabınıza aktarıldı.`,
    'SUCCESS'
  );
  broadcastSync({ type: 'pos:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { settledCount: queuedItems.length } });
  broadcastSync({ type: 'account:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { settledCount: queuedItems.length } });

  res.json({ settledCount: queuedItems.length, totalNet, totalFee, currency: merchantAccount.currency });
});

app.post('/api/merchant/payment-links', requireAuth, (req: AuthedRequest, res) => {
  const entitlements = getUserEntitlements(req.auth!.userId);
  if (!entitlements.allowPosOnline && !entitlements.allowQrBills) {
    return res.status(403).json({ error: 'Yetki izniniz yoktur: Ödeme linki oluşturma yetkiniz kapalıdır.' });
  }
  const mer = ensureMerchantForUser(req.auth!.userId);
  const title = String(req.body?.title || '').trim();
  const amount = Number(req.body?.amount || 0);
  const currency = String(req.body?.currency || 'TRY');
  if (!title || amount <= 0) return res.status(400).json({ error: 'Title and positive amount required.' });
  const id = uid('pl');
  const code = `PM-CHK-${Math.floor(1000 + Math.random() * 8999)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO payment_links (id, merchant_id, title, amount, currency, status, requires_3ds, checkout_code, created_at)
     VALUES (?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?)`
  ).run(id, mer.id, title, amount, currency, code, now);
  res.status(201).json({ id, title, amount, currency, status: 'ACTIVE', checkoutCode: code });
});

// ---------- LIVE SUPPORT HOTLINE & TICKETS + PUBLIC UNLOCK REQUEST ----------
app.post('/api/support/unlock-request', (req, res) => {
  const rawIdentifier = String(req.body?.identifier || '').trim();
  const message = String(req.body?.message || '').trim() || 'Hesabımın güvenlik kilidinin müşteri hizmetleri tarafından açılmasını talep ediyorum.';
  if (!rawIdentifier) return res.status(400).json({ error: 'E-posta, Telefon veya Müşteri No giriniz.' });

  const identifierLower = rawIdentifier.toLowerCase();
  const identifierDigits = normalizeDigits(rawIdentifier);
  let user = db
    .prepare('SELECT * FROM users WHERE LOWER(email) = ? OR customer_number = ?')
    .get(identifierLower, rawIdentifier) as any;

  if (!user && identifierDigits.length >= 7) {
    const tail10 = identifierDigits.slice(-10);
    const allUsers = db.prepare('SELECT * FROM users').all() as any[];
    user = allUsers.find((c) => {
      const cd = normalizeDigits(String(c.phone || ''));
      return cd === identifierDigits || (tail10.length === 10 && cd.endsWith(tail10));
    });
  }

  if (!user) {
    return res.status(404).json({ error: 'Bu bilgiyle eşleşen hesap bulunamadı.' });
  }

  const tktId = uid('tkt');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO support_tickets (id, user_id, subject, category, channel, priority, status, created_at, updated_at)
     VALUES (?, ?, ?, 'Security Lockout', 'UNLOCK_REQUEST', 'HIGH', 'OPEN', ?, ?)`
  ).run(tktId, user.id, `Kilit Açma Talebi — #${user.customer_number}`, now, now);

  db.prepare(
    `INSERT INTO ticket_messages (id, ticket_id, sender_id, sender_name, sender_role, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(uid('tmsg'), tktId, user.id, user.full_name, user.role, message, now);

  const supportAdmins = db
    .prepare("SELECT id FROM users WHERE role IN ('SUPER_ADMIN', 'CUSTOMER_SUPPORT', 'COMPLIANCE_OFFICER', 'SYSTEM_ADMIN')")
    .all() as Array<{ id: string }>;
  for (const adm of supportAdmins) {
    createNotification(
      adm.id,
      `Kilit Açma Talebi (#${user.customer_number})`,
      `${user.full_name} kilitli hesabı için Canlı Destek açma talebi gönderdi.`,
      'WARNING'
    );
  }

  writeAuditLog({
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'UNLOCK_REQUEST_SUBMITTED',
    targetType: 'SUPPORT_TICKET',
    targetId: tktId,
    metadata: `Unlock request opened by #${user.customer_number}`,
  });

  broadcastSync({ type: 'support:message', tenantId: user.tenant_id, data: { ticketId: tktId, channel: 'UNLOCK_REQUEST' } });
  broadcastSync({ type: 'ticket:updated', targetUserId: user.id, tenantId: user.tenant_id, data: { ticketId: tktId } });
  broadcastSync({ type: 'admin:sync', tenantId: user.tenant_id, data: { event: 'UNLOCK_REQUEST', ticketId: tktId } });

  res.status(201).json({ ok: true, ticketId: tktId, customerNumber: user.customer_number });
});

app.post('/api/support/live-chat', requireAuth, (req: AuthedRequest, res) => {
  const message = String(req.body?.message || '').trim();
  const subject = String(req.body?.subject || 'Canlı Destek Hattı').trim();
  if (!message) return res.status(400).json({ error: 'Mesaj boş olamaz.' });

  const now = new Date().toISOString();
  let ticket = db
    .prepare(
      `SELECT * FROM support_tickets
       WHERE user_id = ? AND channel = 'LIVE_CHAT' AND status != 'RESOLVED'
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(req.auth!.userId) as any;

  let ticketId = ticket?.id;
  if (!ticket) {
    ticketId = uid('live');
    db.prepare(
      `INSERT INTO support_tickets (id, user_id, subject, category, channel, priority, status, created_at, updated_at)
       VALUES (?, ?, ?, 'Live Support', 'LIVE_CHAT', 'HIGH', 'OPEN', ?, ?)`
    ).run(ticketId, req.auth!.userId, subject, now, now);

    const supportAdmins = db
      .prepare("SELECT id FROM users WHERE role IN ('SUPER_ADMIN', 'CUSTOMER_SUPPORT', 'SYSTEM_ADMIN')")
      .all() as Array<{ id: string }>;
    for (const adm of supportAdmins) {
      createNotification(
        adm.id,
        'Yeni Canlı Destek Görüşmesi',
        `${req.auth!.fullName} canlı destek hattına bağlandı.`,
        'INFO'
      );
    }
  }

  const msgId = uid('tmsg');
  db.prepare(
    `INSERT INTO ticket_messages (id, ticket_id, sender_id, sender_name, sender_role, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(msgId, ticketId, req.auth!.userId, req.auth!.fullName, req.auth!.role, message, now);
  db.prepare(`UPDATE support_tickets SET updated_at = ? WHERE id = ?`).run(now, ticketId);

  broadcastSync({ type: 'support:message', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { ticketId, msgId } });
  broadcastSync({ type: 'ticket:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { ticketId } });
  broadcastSync({ type: 'admin:sync', tenantId: req.auth!.tenantId, data: { event: 'LIVE_CHAT_MESSAGE', ticketId } });

  res.status(201).json({ ticketId, messageId: msgId, createdAt: now });
});

app.post('/api/tickets', requireAuth, (req: AuthedRequest, res) => {
  const subject = String(req.body?.subject || '').trim();
  const category = String(req.body?.category || 'General');
  const channel = String(req.body?.channel || 'TICKET').toUpperCase();
  const priority = String(req.body?.priority || 'NORMAL');
  const message = String(req.body?.message || '').trim();
  if (!subject || !message) return res.status(400).json({ error: 'Subject and message are required.' });

  const id = uid('tkt');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO support_tickets (id, user_id, subject, category, channel, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`
  ).run(id, req.auth!.userId, subject, category, channel, priority, now, now);
  db.prepare(
    `INSERT INTO ticket_messages (id, ticket_id, sender_id, sender_name, sender_role, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(uid('tmsg'), id, req.auth!.userId, req.auth!.fullName, req.auth!.role, message, now);

  broadcastSync({ type: 'support:message', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { ticketId: id } });
  broadcastSync({ type: 'ticket:updated', targetUserId: req.auth!.userId, tenantId: req.auth!.tenantId, data: { ticketId: id } });
  broadcastSync({ type: 'admin:sync', tenantId: req.auth!.tenantId, data: { event: 'TICKET_CREATED', ticketId: id } });
  res.status(201).json({ id, subject, channel, status: 'OPEN' });
});

app.post('/api/tickets/:id/messages', requireAuth, (req: AuthedRequest, res) => {
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id) as any;
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
  if (ticket.user_id !== req.auth!.userId && !ADMIN_ROLES.has(req.auth!.role)) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message required.' });

  const now = new Date().toISOString();
  const msgId = uid('tmsg');
  db.prepare(
    `INSERT INTO ticket_messages (id, ticket_id, sender_id, sender_name, sender_role, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(msgId, ticket.id, req.auth!.userId, req.auth!.fullName, req.auth!.role, message, now);
  db.prepare(`UPDATE support_tickets SET updated_at = ?, status = ? WHERE id = ?`).run(
    now,
    ADMIN_ROLES.has(req.auth!.role) ? 'IN_PROGRESS' : ticket.status === 'RESOLVED' ? 'OPEN' : ticket.status,
    ticket.id
  );

  broadcastSync({ type: 'support:message', targetUserId: ticket.user_id, tenantId: req.auth!.tenantId, data: { ticketId: ticket.id, msgId } });
  broadcastSync({ type: 'ticket:updated', targetUserId: ticket.user_id, tenantId: req.auth!.tenantId, data: { ticketId: ticket.id } });
  broadcastSync({ type: 'admin:sync', tenantId: req.auth!.tenantId, data: { event: 'TICKET_REPLIED', ticketId: ticket.id } });
  res.status(201).json({ id: msgId, message, createdAt: now });
});

app.patch('/api/admin/tickets/:id/status', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id) as any;
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
  const status = String(req.body?.status || 'RESOLVED').toUpperCase();
  const now = new Date().toISOString();
  db.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, now, ticket.id);
  broadcastSync({ type: 'support:message', targetUserId: ticket.user_id, tenantId: req.auth!.tenantId, data: { ticketId: ticket.id, status } });
  broadcastSync({ type: 'ticket:updated', targetUserId: ticket.user_id, tenantId: req.auth!.tenantId, data: { ticketId: ticket.id, status } });
  broadcastSync({ type: 'admin:sync', tenantId: req.auth!.tenantId, data: { event: 'TICKET_STATUS', ticketId: ticket.id } });
  res.json({ ok: true, status });
});

// ---------- NOTIFICATIONS & DEVELOPER API KEYS ----------
app.post('/api/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.auth!.userId);
  res.json({ ok: true });
});

app.post('/api/developer/api-keys', requireAuth, (req: AuthedRequest, res) => {
  const label = String(req.body?.label || 'Sandbox Integration Key').trim();
  const id = uid('key');
  const rawSecret = `pm_sbx_${crypto.randomBytes(16).toString('hex')}`;
  const prefix = rawSecret.slice(0, 14);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO api_keys (id, user_id, label, key_prefix, environment, scopes_json, status, created_at) VALUES (?, ?, ?, ?, 'SANDBOX', ?, 'ACTIVE', ?)`
  ).run(id, req.auth!.userId, label, prefix, JSON.stringify(['accounts:read', 'payments:write']), now);
  res.status(201).json({ id, label, keyPrefix: prefix, oneTimeKey: rawSecret, environment: 'SANDBOX', status: 'ACTIVE', createdAt: now });
});

// ---------- STATEMENT EXPORT (CSV) ----------
app.get('/api/reports/statement.csv', requireAuth, (req: AuthedRequest, res) => {
  const accountId = typeof req.query.accountId === 'string' && req.query.accountId.trim() ? req.query.accountId.trim() : null;

  let rows: any[] = [];
  if (accountId) {
    const acc = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(accountId, req.auth!.userId);
    if (!acc) return res.status(404).json({ error: 'Account not found.' });
    rows = db
      .prepare(
        `SELECT id, created_at, type, category, counterparty_name, counterparty_iban, direction, amount, fee, currency, status, reference, source, is_sandbox
         FROM transactions
         WHERE user_id = ? AND (from_account_id = ? OR to_account_id = ?)
         ORDER BY created_at DESC`
      )
      .all(req.auth!.userId, accountId, accountId) as any[];
  } else {
    rows = db
      .prepare(
        `SELECT id, created_at, type, category, counterparty_name, counterparty_iban, direction, amount, fee, currency, status, reference, source, is_sandbox
         FROM transactions WHERE user_id = ? ORDER BY created_at DESC`
      )
      .all(req.auth!.userId) as any[];
  }

  const header = 'TransactionID,Date,Type,Category,Counterparty,IBAN,Direction,Amount,Fee,Currency,Status,Reference,Source,Environment\n';
  const body = rows
    .map((r) =>
      [
        r.id,
        r.created_at,
        r.type,
        r.category,
        `"${String(r.counterparty_name).replace(/"/g, '""')}"`,
        r.counterparty_iban || '',
        r.direction,
        r.amount,
        r.fee,
        r.currency,
        r.status,
        r.reference,
        r.source,
        r.is_sandbox ? 'SANDBOX_TEST' : 'PRODUCTION',
      ].join(',')
    )
    .join('\n');

  const fileSuffix = accountId ? `-${accountId}` : '';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pro-money-statement${fileSuffix}.csv"`);
  res.send('\uFEFF' + header + body);
});

// ---------- AI FINANCIAL ASSISTANT ----------
app.post('/api/ai/assistant', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });
    const result = await runFinancialAssistant({
      userId: req.auth!.userId,
      prompt,
      history: Array.isArray(req.body?.history) ? req.body.history : [],
    });
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message || 'PRO MONEY AI Assistant unavailable.' });
  }
});

// ---------- SUPER ADMIN PLATFORM ----------
app.get('/api/admin/overview', requireAuth, requireAdmin, (_req: AuthedRequest, res) => {
  const users = (db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as any[]).map(mapUserRow);
  const accounts = (db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all() as any[]).map(mapAccountRow);
  const pools = db.prepare('SELECT * FROM central_fund_pools ORDER BY code ASC').all() as any[];
  const transactions = (db.prepare('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 120').all() as any[]).map(mapTxRow);
  const ledgerEntries = db.prepare('SELECT * FROM ledger_entries ORDER BY created_at DESC LIMIT 150').all() as any[];
  const poolLedgerEntries = db
    .prepare('SELECT * FROM ledger_entries WHERE pool_id IS NOT NULL ORDER BY created_at DESC LIMIT 100')
    .all() as any[];
  const debitSum = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM ledger_entries WHERE entry_type = 'DEBIT'`).get() as { total: number };
  const creditSum = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM ledger_entries WHERE entry_type = 'CREDIT'`).get() as { total: number };
  const cards = (db.prepare('SELECT * FROM cards ORDER BY created_at DESC').all() as any[]).map(mapCardRow);
  const merchants = db.prepare('SELECT * FROM merchants').all() as any[];
  const terminals = (
    db
      .prepare(
        `SELECT p.*, COALESCE(u.full_name, m.business_name) as owner_name
         FROM pos_terminals p
         LEFT JOIN merchants m ON m.id = p.merchant_id
         LEFT JOIN users u ON u.id = COALESCE(p.owner_user_id, m.user_id)
         ORDER BY CASE WHEN p.approval_status = 'PENDING_APPROVAL' THEN 0 ELSE 1 END, p.last_heartbeat DESC`
      )
      .all() as any[]
  ).map(mapTerminalRow);
  const offlinePosQueue = (
    db
      .prepare(
        `SELECT q.*, p.serial_number as terminal_serial, p.location_name as terminal_location
         FROM offline_pos_queue q
         LEFT JOIN pos_terminals p ON p.id = q.terminal_id
         ORDER BY q.created_at DESC LIMIT 80`
      )
      .all() as any[]
  ).map(mapOfflineQueueRow);
  const operationSettings = getSystemOperationSettings();
  const kycRecords = db.prepare('SELECT * FROM kyc_kyb_records ORDER BY created_at DESC').all() as any[];
  const amlCases = db.prepare('SELECT * FROM aml_fraud_cases ORDER BY created_at DESC').all() as any[];
  const auditLogs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 120').all() as any[];
  const providers = db.prepare('SELECT * FROM providers').all() as any[];
  const tenants = db.prepare('SELECT * FROM tenants').all() as any[];
  const loans = db.prepare('SELECT * FROM loans ORDER BY created_at DESC').all() as any[];
  const tickets = (
    db
      .prepare(
        `SELECT t.*, u.full_name as user_name, u.email as user_email, u.customer_number as user_customer_number, u.is_locked as user_is_locked
         FROM support_tickets t
         LEFT JOIN users u ON u.id = t.user_id
         ORDER BY CASE WHEN t.status = 'OPEN' THEN 0 WHEN t.status = 'IN_PROGRESS' THEN 1 ELSE 2 END, t.updated_at DESC`
      )
      .all() as any[]
  ).map((t) => ({
    id: t.id,
    userId: t.user_id,
    subject: t.subject,
    category: t.category,
    channel: t.channel || 'TICKET',
    priority: t.priority,
    status: t.status,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    userName: t.user_name || undefined,
    userEmail: t.user_email || undefined,
    userCustomerNumber: t.user_customer_number || undefined,
    userIsLocked: Boolean(t.user_is_locked),
    messages: (db.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC').all(t.id) as any[]).map((m) => ({
      id: m.id,
      ticketId: m.ticket_id,
      senderId: m.sender_id,
      senderName: m.sender_name,
      senderRole: m.sender_role,
      message: m.message,
      createdAt: m.created_at,
    })),
  }));
  const dualApprovals = db.prepare('SELECT * FROM dual_approvals ORDER BY created_at DESC').all() as any[];
  const verifications = (
    db
      .prepare(
        `SELECT v.*, u.full_name as subject_name, u.customer_number as customer_number
         FROM identity_verifications v
         JOIN users u ON u.id = v.user_id
         ORDER BY CASE WHEN v.status = 'PENDING' THEN 0 ELSE 1 END, v.created_at DESC`
      )
      .all() as any[]
  ).map(mapVerificationRow);

  const pendingApprovals = users.filter((u) => u.approvalStatus === 'PENDING_APPROVAL');

  res.json({
    users,
    pendingApprovals,
    accounts,
    pools,
    transactions,
    ledgerEntries,
    poolLedgerEntries,
    reconciliation: {
      totalDebits: Number(debitSum.total.toFixed(2)),
      totalCredits: Number(creditSum.total.toFixed(2)),
      delta: Number((debitSum.total - creditSum.total).toFixed(2)),
      isBalanced: Math.abs(debitSum.total - creditSum.total) < 0.01,
    },
    cards,
    merchants,
    terminals,
    offlinePosQueue,
    operationSettings,
    kycRecords,
    verifications,
    amlCases,
    auditLogs,
    providers,
    tenants,
    loans,
    tickets,
    dualApprovals,
    dbStats: getDatabaseTableStats(),
    realtimeClients: getConnectedClientCount(),
    realtimeBreakdown: getRealtimeBreakdown(),
  });
});

app.post('/api/admin/users/:id/unlock', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

  const now = new Date().toISOString();
  db.prepare(`UPDATE users SET is_locked = 0, failed_login_attempts = 0, locked_until = NULL, lock_reason = NULL WHERE id = ?`).run(target.id);
  db.prepare(
    `UPDATE support_tickets SET status = 'RESOLVED', updated_at = ? WHERE user_id = ? AND channel = 'UNLOCK_REQUEST' AND status != 'RESOLVED'`
  ).run(now, target.id);

  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: 'ADMIN_USER_UNLOCKED',
    targetType: 'USER',
    targetId: target.id,
    metadata: `Unlocked user ${target.email} (#${target.customer_number}) by ${req.auth!.email}`,
  });

  createNotification(
    target.id,
    'Hesap Kilidiniz Açıldı',
    'Müşteri Hizmetleri hesabınızdaki güvenlik kilidini kaldırdı. Tekrar giriş yapabilirsiniz.',
    'SUCCESS'
  );
  broadcastSync({ type: 'profile:updated', targetUserId: target.id, tenantId: target.tenant_id, data: { isLocked: false } });
  broadcastSync({ type: 'support:message', targetUserId: target.id, tenantId: target.tenant_id, data: { unlocked: true } });
  broadcastSync({ type: 'admin:sync', tenantId: req.auth!.tenantId, data: { event: 'USER_UNLOCKED', userId: target.id } });

  res.json(mapUserRow(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)));
});

app.post('/api/admin/users/:id/lock', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  if (target.id === req.auth!.userId) {
    return res.status(400).json({ error: 'Kendi aktif yönetici hesabınızı kilitleyemezsiniz.' });
  }

  const reason = String(req.body?.reason || 'Yönetim tarafından güvenlik kilidi uygulandı').trim();
  const lockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE users SET is_locked = 1, locked_until = ?, lock_reason = ? WHERE id = ?`).run(lockedUntil, reason, target.id);
  db.prepare(`UPDATE sessions SET revoked = 1 WHERE user_id = ?`).run(target.id);

  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: 'ADMIN_USER_LOCKED',
    targetType: 'USER',
    targetId: target.id,
    metadata: `Locked user ${target.email}: ${reason}`,
  });

  broadcastSync({ type: 'security:alert', targetUserId: target.id, tenantId: target.tenant_id, data: { isLocked: true } });
  broadcastSync({ type: 'admin:sync', tenantId: req.auth!.tenantId, data: { event: 'USER_LOCKED', userId: target.id } });

  res.json(mapUserRow(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)));
});

app.post('/api/admin/approvals/:id/decide', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const decision = req.body?.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
  const initialBalanceTry = Math.max(0, Math.min(1000000, Number(req.body?.initialBalanceTry ?? 6000)));
  const applicant = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!applicant) return res.status(404).json({ error: 'Applicant not found.' });

  const now = new Date().toISOString();
  if (decision === 'REJECTED') {
    db.prepare(`UPDATE users SET approval_status = 'REJECTED', kyc_status = 'REJECTED' WHERE id = ?`).run(applicant.id);
    writeAuditLog({
      actorUserId: req.auth!.userId,
      actorEmail: req.auth!.email,
      actorRole: req.auth!.role,
      action: 'ACCOUNT_APPLICATION_REJECTED',
      targetType: 'USER',
      targetId: applicant.id,
      metadata: `Rejected ${applicant.email} (#${applicant.customer_number})`,
    });
    broadcastSync({ type: 'admin:sync', tenantId: req.auth!.tenantId, data: { event: 'APPROVAL_DECIDED', userId: applicant.id } });
    return res.json({ ok: true, approvalStatus: 'REJECTED' });
  }

  let tryAccountId = '';
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE users SET approval_status = 'APPROVED', kyc_status = 'VERIFIED' WHERE id = ?`).run(applicant.id);

    const existingAcc = db.prepare('SELECT id FROM accounts WHERE user_id = ? LIMIT 1').get(applicant.id) as any;
    if (!existingAcc) {
      const randTry = Math.floor(10000000 + Math.random() * 89999999);
      const randEur = Math.floor(10000000 + Math.random() * 89999999);
      tryAccountId = uid('acc');
      const eurAccId = uid('acc');
      let bizId: string | null = null;

      if (applicant.account_category === 'Business') {
        bizId = uid('biz');
        const compName = applicant.requested_company_name || `${applicant.full_name} Ticaret A.Ş.`;
        db.prepare(
          `INSERT INTO businesses (id, owner_user_id, company_name, registration_number, tax_id, country, kyb_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'VERIFIED', ?)`
        ).run(bizId, applicant.id, compName, `REG-${randTry}`, applicant.requested_tax_id || `TAX-${randTry}`, applicant.country, now);
        db.prepare(
          `INSERT INTO business_members (id, business_id, user_id, full_name, email, role_title, permissions_json, approval_limit, status)
           VALUES (?, ?, ?, ?, ?, 'Managing Director', ?, 100000, 'ACTIVE')`
        ).run(uid('bm'), bizId, applicant.id, applicant.full_name, applicant.email, JSON.stringify(['VIEW_ACCOUNTS', 'INITIATE_PAYMENT', 'APPROVE_PAYMENT', 'MANAGE_CARDS', 'MANAGE_TEAM']));
      } else if (applicant.account_category === 'Merchant') {
        const merId = uid('mer');
        const merName = applicant.requested_company_name || `${applicant.full_name} POS`;
        db.prepare(
          `INSERT INTO merchants (id, user_id, business_name, mcc, country, settlement_currency, verification_status, acquirer_status, volume_30d)
           VALUES (?, ?, ?, '5999', ?, 'TRY', 'VERIFIED', 'SANDBOX_ACQUIRER', 0)`
        ).run(merId, applicant.id, merName, applicant.country);
        db.prepare(
          `INSERT INTO pos_terminals (id, merchant_id, serial_number, model, location_name, status, supports_contactless, supports_qr, supports_offline_rules, last_heartbeat)
           VALUES (?, ?, ?, 'PRO MONEY Terminal X2 (EMV/NFC)', 'Ana Kasa', 'ONLINE_SANDBOX', 1, 1, 1, ?)`
        ).run(uid('pos'), merId, `PM-POS-${randTry}`, now);
      }

      const accType = applicant.account_category === 'Business' ? 'BUSINESS' : 'PERSONAL';
      db.prepare(
        `INSERT INTO accounts (id, tenant_id, user_id, business_id, account_number, iban, bic, type, label, currency, available_balance, ledger_balance, blocked_amount, pending_amount, status, is_sandbox, created_at)
         VALUES (?, 'tenant_promoney', ?, ?, ?, ?, 'PMNYTRISXXX', ?, 'TRY Ana Vadesiz Hesap', 'TRY', 0, 0, 0, 0, 'ACTIVE', 1, ?)`
      ).run(tryAccountId, applicant.id, bizId, `PM-${randTry}`, `TR${Math.floor(10 + Math.random() * 89)}000610051978${randTry}`, accType, now);

      db.prepare(
        `INSERT INTO accounts (id, tenant_id, user_id, business_id, account_number, iban, bic, type, label, currency, available_balance, ledger_balance, blocked_amount, pending_amount, status, is_sandbox, created_at)
         VALUES (?, 'tenant_promoney', ?, ?, ?, ?, 'PMNYDEFFXXX', 'MULTI_CURRENCY', 'EUR Döviz Hesabı', 'EUR', 0, 0, 0, 0, 'ACTIVE', 1, ?)`
      ).run(eurAccId, applicant.id, bizId, `PM-${randEur}`, `DE${Math.floor(10 + Math.random() * 89)}5001051754${randEur}`, now);
    } else {
      tryAccountId = existingAcc.id;
    }

    writeAuditLog({
      actorUserId: req.auth!.userId,
      actorEmail: req.auth!.email,
      actorRole: req.auth!.role,
      action: 'ACCOUNT_APPLICATION_APPROVED',
      targetType: 'USER',
      targetId: applicant.id,
      metadata: `Approved ${applicant.email} (#${applicant.customer_number}, ${applicant.account_category})`,
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  if (initialBalanceTry > 0 && tryAccountId) {
    executeSandboxDeposit({
      userId: applicant.id,
      accountId: tryAccountId,
      amount: initialBalanceTry,
      sourceLabel: 'PRO MONEY Yönetim Açılış Bakiyesi',
    });
  }

  createNotification(
    applicant.id,
    'PRO MONEY Hesabınız Onaylandı',
    `Müşteri No #${applicant.customer_number} yönetim tarafından onaylandı ve hesaplarınız aktif edildi.`,
    'SUCCESS'
  );
  broadcastSync({ type: 'admin:sync', tenantId: req.auth!.tenantId, data: { event: 'APPROVAL_DECIDED', userId: applicant.id } });
  res.json({ ok: true, approvalStatus: 'APPROVED' });
});

app.post('/api/admin/customers', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const fullName = String(req.body?.fullName || '').trim();
  const phone = String(req.body?.phone || '+90 500 000 0000').trim();
  const country = String(req.body?.country || 'TR').trim().toUpperCase();
  const role = String(req.body?.role || 'INDIVIDUAL_CUSTOMER') as UserRole;
  const currency = String(req.body?.currency || 'TRY').toUpperCase();

  if (!email || !fullName) return res.status(400).json({ error: 'Email and full name are required.' });
  const exists = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email);
  if (exists) return res.status(409).json({ error: 'User with this email already exists.' });

  const userId = uid('usr');
  const now = new Date().toISOString();
  const cat = role === 'BUSINESS_MANAGER' ? 'Business' : role === 'MERCHANT' ? 'Merchant' : ADMIN_ROLES.has(role) ? 'Administrator' : 'Personal';
  const customerNumber = String(Math.floor(400000 + Math.random() * 499999));

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO users (id, tenant_id, customer_number, email, password_hash, full_name, phone, country, role, account_category, membership_tier, kyc_status, approval_status, mfa_enabled, passkey_count, created_at)
       VALUES (?, 'tenant_promoney', ?, ?, ?, ?, ?, ?, ?, ?, 'Standard', 'VERIFIED', 'APPROVED', 0, 0, ?)`
    ).run(userId, customerNumber, email, hashPassword('ProMoney2026!'), fullName, phone, country, role, cat, now);

    const accId = uid('acc');
    const num = Math.floor(10000000 + Math.random() * 89999999);
    const ibanPrefix = currency === 'TRY' ? 'TR' : 'DE';
    db.prepare(
      `INSERT INTO accounts (id, tenant_id, user_id, business_id, account_number, iban, bic, type, label, currency, available_balance, ledger_balance, blocked_amount, pending_amount, status, is_sandbox, created_at)
       VALUES (?, 'tenant_promoney', ?, NULL, ?, ?, 'PMNYTRISXXX', ?, ?, ?, 0, 0, 0, 0, 'ACTIVE', 1, ?)`
    ).run(accId, userId, `PM-${num}`, `${ibanPrefix}${Math.floor(10 + Math.random() * 89)}5001051754${num}`, cat === 'Business' ? 'BUSINESS' : 'PERSONAL', `${currency} Primary`, currency, now);

    writeAuditLog({
      actorUserId: req.auth!.userId,
      actorEmail: req.auth!.email,
      actorRole: req.auth!.role,
      action: 'ADMIN_CREATE_USER',
      targetType: 'USER',
      targetId: userId,
      metadata: `Created ${role} (${email}, #${customerNumber}) with ${currency} account`,
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcastSync({ type: 'admin:sync', tenantId: req.auth!.tenantId, data: { event: 'ADMIN_CREATE_USER', userId } });
  res.status(201).json(mapUserRow(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)));
});

app.patch('/api/admin/kyc/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const status = String(req.body?.status || 'VERIFIED');
  const kyc = db.prepare('SELECT * FROM kyc_kyb_records WHERE id = ?').get(req.params.id) as any;
  if (!kyc) return res.status(404).json({ error: 'KYC record not found.' });

  db.prepare('UPDATE kyc_kyb_records SET status = ?, reviewed_by = ? WHERE id = ?').run(status, req.auth!.userId, kyc.id);
  db.prepare('UPDATE users SET kyc_status = ? WHERE id = ?').run(status, kyc.user_id);

  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: `KYC_${status}`,
    targetType: 'KYC_RECORD',
    targetId: kyc.id,
    metadata: `Updated subject ${kyc.subject_name} to ${status}`,
  });

  createNotification(kyc.user_id, `Identity Verification ${status}`, `Your ${kyc.record_type} verification status was updated to ${status}.`, status === 'VERIFIED' ? 'SUCCESS' : 'WARNING');
  broadcastSync({ type: 'compliance:updated', targetUserId: kyc.user_id, tenantId: req.auth!.tenantId, data: { kycId: kyc.id, status } });
  broadcastSync({ type: 'profile:updated', targetUserId: kyc.user_id, tenantId: req.auth!.tenantId, data: { kycStatus: status } });
  res.json({ ok: true, status });
});

app.patch('/api/admin/verifications/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const status = req.body?.status === 'REJECTED' ? 'REJECTED' : 'VERIFIED';
  const rejectionReason = String(req.body?.rejectionReason || '').trim() || null;
  const ver = db.prepare('SELECT * FROM identity_verifications WHERE id = ?').get(req.params.id) as any;
  if (!ver) return res.status(404).json({ error: 'Verification record not found.' });

  const now = new Date().toISOString();
  const isVerified = status === 'VERIFIED' ? 1 : 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE identity_verifications SET status = ?, rejection_reason = ?, verified_by = ?, verified_at = ? WHERE id = ?`
    ).run(status, status === 'REJECTED' ? rejectionReason || 'Document mismatch' : null, req.auth!.userId, now, ver.id);

    if (ver.verification_type === 'IDENTITY_CARD') {
      db.prepare('UPDATE users SET identity_verified = ? WHERE id = ?').run(isVerified, ver.user_id);
    } else if (ver.verification_type === 'PASSPORT') {
      db.prepare('UPDATE users SET passport_verified = ? WHERE id = ?').run(isVerified, ver.user_id);
    } else if (ver.verification_type === 'ADDRESS') {
      db.prepare('UPDATE users SET address_verified = ? WHERE id = ?').run(isVerified, ver.user_id);
    } else if (ver.verification_type === 'PHONE') {
      db.prepare('UPDATE users SET phone_verified = ? WHERE id = ?').run(isVerified, ver.user_id);
    }

    const u = db
      .prepare('SELECT identity_verified, passport_verified, address_verified, phone_verified FROM users WHERE id = ?')
      .get(ver.user_id) as any;
    const allClear = (u.identity_verified || u.passport_verified) && u.address_verified && u.phone_verified;
    const nextKyc = status === 'REJECTED' ? 'REJECTED' : allClear ? 'VERIFIED' : 'PENDING';
    db.prepare('UPDATE users SET kyc_status = ? WHERE id = ?').run(nextKyc, ver.user_id);

    writeAuditLog({
      actorUserId: req.auth!.userId,
      actorEmail: req.auth!.email,
      actorRole: req.auth!.role,
      action: `VERIFICATION_${ver.verification_type}_${status}`,
      targetType: 'VERIFICATION',
      targetId: ver.id,
      metadata: `Reviewed ${ver.verification_type} for user ${ver.user_id} -> ${status}`,
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  createNotification(
    ver.user_id,
    `${ver.verification_type} ${status}`,
    `Your ${ver.verification_type} check was marked ${status}.`,
    status === 'VERIFIED' ? 'SUCCESS' : 'WARNING'
  );
  broadcastSync({ type: 'compliance:updated', targetUserId: ver.user_id, tenantId: req.auth!.tenantId, data: { verificationId: ver.id, status } });
  broadcastSync({ type: 'profile:updated', targetUserId: ver.user_id, tenantId: req.auth!.tenantId, data: { verificationId: ver.id } });
  res.json({ ok: true, status });
});

app.patch('/api/admin/aml/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const status = String(req.body?.status || 'CLEARED');
  const aml = db.prepare('SELECT * FROM aml_fraud_cases WHERE id = ?').get(req.params.id) as any;
  if (!aml) return res.status(404).json({ error: 'Case not found.' });

  db.prepare('UPDATE aml_fraud_cases SET status = ? WHERE id = ?').run(status, aml.id);
  if (status === 'CLEARED' && aml.transaction_id) {
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(aml.transaction_id) as any;
    if (tx && tx.status === 'FLAGGED') {
      db.prepare(`UPDATE transactions SET status = 'COMPLETED' WHERE id = ?`).run(tx.id);
      if (tx.from_account_id) {
        const total = Number((tx.amount + tx.fee).toFixed(2));
        db.prepare(
          `UPDATE accounts SET pending_amount = MAX(0, ROUND(pending_amount - ?, 2)), ledger_balance = ROUND(ledger_balance - ?, 2) WHERE id = ?`
        ).run(total, total, tx.from_account_id);
      }
    }
  }

  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: `AML_CASE_${status}`,
    targetType: 'AML_CASE',
    targetId: aml.id,
    metadata: `Updated AML/Fraud case to ${status}`,
  });

  broadcastSync({ type: 'compliance:updated', targetUserId: aml.user_id, tenantId: req.auth!.tenantId, data: { amlId: aml.id, status } });
  res.json({ ok: true, status });
});

app.post('/api/admin/transactions/:id/reverse', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  try {
    const rev = executeReversal({
      actorUserId: req.auth!.userId,
      actorEmail: req.auth!.email,
      actorRole: req.auth!.role,
      transactionId: req.params.id,
      reason: String(req.body?.reason || 'Admin compliance reversal'),
    });
    res.json(mapTxRow(rev));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/admin/memberships/:tier', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const tier = req.params.tier;
  const price = Number(req.body?.monthlyPriceEur);
  const dailyLimit = Number(req.body?.dailyTransferLimitEur);
  const bps = Number(req.body?.fxMarkupBps);
  db.prepare(
    `UPDATE membership_plans SET monthly_price_eur = COALESCE(?, monthly_price_eur), daily_transfer_limit_eur = COALESCE(?, daily_transfer_limit_eur), fx_markup_bps = COALESCE(?, fx_markup_bps) WHERE tier = ?`
  ).run(Number.isFinite(price) ? price : null, Number.isFinite(dailyLimit) ? dailyLimit : null, Number.isFinite(bps) ? bps : null, tier);

  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: 'MEMBERSHIP_PLAN_UPDATED',
    targetType: 'MEMBERSHIP',
    targetId: tier,
    metadata: `Price=${price}, DailyLimit=${dailyLimit}, FX_BPS=${bps}`,
  });
  broadcastSync({ type: 'admin:sync', tenantId: req.auth!.tenantId, data: { event: 'MEMBERSHIP_UPDATED', tier } });
  res.json({ ok: true });
});

app.post('/api/admin/dual-approvals/:id/decide', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const decision = req.body?.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
  const row = db.prepare('SELECT * FROM dual_approvals WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'Dual approval request not found.' });
  if (row.requested_by_user_id === req.auth!.userId) {
    return res.status(400).json({ error: 'Dual control rule: requester cannot approve their own action.' });
  }
  db.prepare('UPDATE dual_approvals SET status = ?, approved_by_user_id = ? WHERE id = ?').run(decision, req.auth!.userId, row.id);
  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: `DUAL_APPROVAL_${decision}`,
    targetType: 'DUAL_APPROVAL',
    targetId: row.id,
    metadata: `ActionType=${row.action_type}`,
  });
  res.json({ ok: true, status: decision });
});

app.patch('/api/admin/entitlements/:userId', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const targetUser = db.prepare('SELECT id, email, full_name, tenant_id FROM users WHERE id = ?').get(req.params.userId) as any;
  if (!targetUser) return res.status(404).json({ error: 'User not found.' });

  const updated = upsertUserEntitlements(req.params.userId, req.body || {}, req.auth!.userId);
  if (updated.allowPosOnline || updated.allowPosOffline) {
    ensureMerchantForUser(req.params.userId);
  }

  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: 'MEMBER_ENTITLEMENTS_UPDATED',
    targetType: 'USER',
    targetId: req.params.userId,
    metadata: `Updated permissions for ${targetUser.email}: POS_ON=${updated.allowPosOnline}, POS_OFF=${updated.allowPosOffline}, SWIFT=${updated.allowSwift}, CREDIT=${updated.allowCreditCards}, TOPUP=${updated.allowCardTopup}`,
  });

  createNotification(
    req.params.userId,
    'Hesap & İşlem Yetkileriniz Güncellendi',
    'Yönetim tarafından hesabınıza tanımlanan ürün ve işlem izinleri güncellendi.',
    'INFO'
  );
  broadcastSync({ type: 'profile:updated', targetUserId: req.params.userId, tenantId: targetUser.tenant_id, data: { entitlements: updated } });
  broadcastSync({ type: 'admin:sync', tenantId: req.auth!.tenantId, data: { event: 'ENTITLEMENTS_UPDATED', userId: req.params.userId } });

  res.json(updated);
});

app.patch('/api/admin/system-settings/:key', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  try {
    const updated = upsertSystemOperationSetting(req.params.key, req.body || {}, req.auth!.userId);
    writeAuditLog({
      actorUserId: req.auth!.userId,
      actorEmail: req.auth!.email,
      actorRole: req.auth!.role,
      action: 'SYSTEM_OPERATION_SETTING_UPDATED',
      targetType: 'OPERATION_SETTING',
      targetId: req.params.key,
      metadata: `Enabled=${updated.enabled}, FeeFixed=${updated.feeFixed}, FeePct=${updated.feePercent}%, Max=${updated.maxAmount}`,
    });
    broadcastSync({ type: 'admin:sync', tenantId: req.auth!.tenantId, data: { event: 'SETTING_UPDATED', key: req.params.key } });
    res.json(updated);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

app.patch('/api/admin/pos/:id/decide', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const terminal = db.prepare('SELECT * FROM pos_terminals WHERE id = ?').get(req.params.id) as any;
  if (!terminal) return res.status(404).json({ error: 'POS terminali bulunamadı.' });

  const decision = req.body?.approvalStatus === 'REJECTED' ? 'REJECTED' : 'APPROVED';
  const terminalMode = String(req.body?.terminalMode || terminal.terminal_mode || 'HYBRID').toUpperCase();
  const onlineEnabled =
    decision === 'APPROVED'
      ? req.body?.onlineEnabled !== undefined
        ? (req.body.onlineEnabled ? 1 : 0)
        : terminalMode !== 'OFFLINE'
        ? 1
        : 0
      : 0;
  const offlineEnabled =
    decision === 'APPROVED'
      ? req.body?.offlineEnabled !== undefined
        ? (req.body.offlineEnabled ? 1 : 0)
        : terminalMode !== 'ONLINE'
        ? 1
        : 0
      : 0;
  const floorLimit = Math.max(0, Number(req.body?.offlineFloorLimit ?? terminal.offline_floor_limit ?? 5000));
  const nextStatus = decision === 'APPROVED' ? (onlineEnabled ? 'ONLINE_SANDBOX' : 'OFFLINE') : 'OFFLINE';
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE pos_terminals
     SET approval_status = ?, terminal_mode = ?, online_enabled = ?, offline_enabled = ?, offline_floor_limit = ?,
         supports_offline_rules = ?, status = ?, approved_by = ?, approved_at = ?, last_heartbeat = ?
     WHERE id = ?`
  ).run(decision, terminalMode, onlineEnabled, offlineEnabled, floorLimit, offlineEnabled, nextStatus, req.auth!.userId, now, now, terminal.id);

  let ownerId = terminal.owner_user_id;
  if (!ownerId) {
    const m = db.prepare('SELECT user_id FROM merchants WHERE id = ?').get(terminal.merchant_id) as { user_id: string } | undefined;
    ownerId = m?.user_id;
  }

  if (ownerId && decision === 'APPROVED') {
    const patch: any = {};
    if (onlineEnabled) patch.allowPosOnline = true;
    if (offlineEnabled) patch.allowPosOffline = true;
    if (Object.keys(patch).length > 0) {
      upsertUserEntitlements(ownerId, patch, req.auth!.userId);
    }
  }

  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: `POS_TERMINAL_${decision}`,
    targetType: 'POS_TERMINAL',
    targetId: terminal.id,
    metadata: `Serial=${terminal.serial_number}, Mode=${terminalMode}, Online=${onlineEnabled}, Offline=${offlineEnabled}, Floor=${floorLimit}`,
  });

  if (ownerId) {
    createNotification(
      ownerId,
      decision === 'APPROVED' ? 'POS Cihazınız Yönetim Tarafından Onaylandı' : 'POS Cihazı Talebi Reddedildi',
      decision === 'APPROVED'
        ? `${terminal.serial_number} (${terminalMode}) cihazı Online=${onlineEnabled ? 'Açık' : 'Kapalı'}, Offline=${offlineEnabled ? 'Açık' : 'Kapalı'} olarak açıldı.`
        : `${terminal.serial_number} POS cihazı başvurunuz onaylanmadı.`,
      decision === 'APPROVED' ? 'SUCCESS' : 'WARNING'
    );
    broadcastSync({ type: 'pos:updated', targetUserId: ownerId, tenantId: req.auth!.tenantId, data: { terminalId: terminal.id } });
    broadcastSync({ type: 'profile:updated', targetUserId: ownerId, tenantId: req.auth!.tenantId, data: { terminalId: terminal.id } });
  }
  broadcastSync({ type: 'admin:sync', tenantId: req.auth!.tenantId, data: { event: 'POS_DECIDED', terminalId: terminal.id } });

  res.json(mapTerminalRow(db.prepare('SELECT * FROM pos_terminals WHERE id = ?').get(terminal.id)));
});

// ---------- CENTRAL FUND POOLS MANAGEMENT & SQL EXPORT ----------
app.get('/api/admin/export.sql', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const sqlDump = exportFullDatabaseSql();
  writeAuditLog({
    actorUserId: req.auth!.userId,
    actorEmail: req.auth!.email,
    actorRole: req.auth!.role,
    action: 'DATABASE_SQL_EXPORTED',
    targetType: 'DATABASE',
    targetId: 'promoney.db',
    metadata: `Exported live SQLite dump (${sqlDump.length} bytes)`,
  });
  res.setHeader('Content-Type', 'application/sql; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="pro-money-database.sql"');
  res.send(sqlDump);
});

app.get('/api/admin/pools', requireAuth, requireAdmin, (_req: AuthedRequest, res) => {
  const pools = db.prepare('SELECT * FROM central_fund_pools ORDER BY is_primary_clearing DESC, code ASC').all() as any[];
  const poolLedgerEntries = db
    .prepare('SELECT * FROM ledger_entries WHERE pool_id IS NOT NULL ORDER BY created_at DESC LIMIT 100')
    .all() as any[];
  res.json({ pools, poolLedgerEntries });
});

app.post('/api/admin/pools', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  try {
    const created = createCentralFundPool({
      actorUserId: req.auth!.userId,
      actorEmail: req.auth!.email,
      actorRole: req.auth!.role,
      tenantId: req.auth!.tenantId,
      code: String(req.body?.code || ''),
      name: String(req.body?.name || ''),
      bankName: String(req.body?.bankName || ''),
      iban: req.body?.iban ? String(req.body.iban) : undefined,
      bic: req.body?.bic ? String(req.body.bic) : undefined,
      category: req.body?.category ? String(req.body.category) : undefined,
      currency: String(req.body?.currency || 'TRY'),
      initialBalance: Number(req.body?.initialBalance ?? 0),
      segregated: req.body?.segregated !== undefined ? Boolean(req.body.segregated) : true,
      custodianStatus: req.body?.custodianStatus ? String(req.body.custodianStatus) : undefined,
      routingMode: req.body?.routingMode,
      setAsPrimaryClearing: Boolean(req.body?.setAsPrimaryClearing),
    });
    res.status(201).json(created);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/pools/:id/adjust', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  try {
    const direction = req.body?.direction === 'DEBIT' ? 'DEBIT' : 'CREDIT';
    const amount = Number(req.body?.amount || 0);
    const reason = String(req.body?.reason || '').trim() || `Admin pool ${direction}`;
    const custodianStatus = typeof req.body?.custodianStatus === 'string' && req.body.custodianStatus.trim() ? req.body.custodianStatus.trim() : undefined;
    const updatedPool = adjustCentralFundPool({
      actorUserId: req.auth!.userId,
      actorEmail: req.auth!.email,
      actorRole: req.auth!.role,
      tenantId: req.auth!.tenantId,
      poolId: req.params.id,
      direction,
      amount,
      reason,
      custodianStatus,
    });
    res.json(updatedPool);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/pools/transfer', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  try {
    const fromPoolId = String(req.body?.fromPoolId || '').trim();
    const toPoolId = String(req.body?.toPoolId || '').trim();
    const amount = Number(req.body?.amount || 0);
    const reason = String(req.body?.reason || '').trim() || 'Inter-pool liquidity rebalance';
    const result = transferBetweenCentralFundPools({
      actorUserId: req.auth!.userId,
      actorEmail: req.auth!.email,
      actorRole: req.auth!.role,
      tenantId: req.auth!.tenantId,
      fromPoolId,
      toPoolId,
      amount,
      reason,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/admin/pools/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const pool = db.prepare('SELECT * FROM central_fund_pools WHERE id = ?').get(req.params.id) as any;
  if (!pool) return res.status(404).json({ error: 'Central fund pool not found.' });

  const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : pool.name;
  const bankName =
    typeof req.body?.bankName === 'string' && req.body.bankName.trim() ? req.body.bankName.trim() : pool.bank_name;
  const iban = typeof req.body?.iban === 'string' ? req.body.iban.trim().toUpperCase() || null : pool.iban;
  const bic = typeof req.body?.bic === 'string' ? req.body.bic.trim().toUpperCase() || null : pool.bic;
  const custodianStatus =
    typeof req.body?.custodianStatus === 'string' && req.body.custodianStatus.trim()
      ? req.body.custodianStatus.trim()
      : pool.custodian_status;
  const segregated = req.body?.segregated !== undefined ? (req.body.segregated ? 1 : 0) : pool.segregated;
  const setAsPrimary = req.body?.setAsPrimaryClearing === true;
  const isPrimary = req.body?.setAsPrimaryClearing !== undefined ? (setAsPrimary ? 1 : 0) : pool.is_primary_clearing;
  const rawRouting = req.body?.routingMode ? String(req.body.routingMode).toUpperCase() : undefined;
  const routingMode = rawRouting && ['ALL', 'INFLOW', 'OUTFLOW', 'STANDBY'].includes(rawRouting)
    ? rawRouting
    : setAsPrimary
    ? 'ALL'
    : pool.routing_mode || 'STANDBY';
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    if (setAsPrimary) {
      db.prepare('UPDATE central_fund_pools SET is_primary_clearing = 0').run();
    }
    db.prepare(
      `UPDATE central_fund_pools
       SET name = ?, bank_name = ?, iban = ?, bic = ?, custodian_status = ?, segregated = ?,
           is_primary_clearing = ?, routing_mode = ?, updated_at = ?
       WHERE id = ?`
    ).run(name, bankName, iban, bic, custodianStatus, segregated, isPrimary, routingMode, now, pool.id);

    writeAuditLog({
      actorUserId: req.auth!.userId,
      actorEmail: req.auth!.email,
      actorRole: req.auth!.role,
      action: setAsPrimary ? 'CENTRAL_POOL_SET_PRIMARY_CLEARING' : 'CENTRAL_POOL_METADATA_UPDATED',
      targetType: 'CENTRAL_FUND_POOL',
      targetId: pool.id,
      metadata: `Pool ${pool.code} (${bankName}): primary=${isPrimary}, routing=${routingMode}, status=${custodianStatus}`,
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcastSync({ type: 'pool:updated', tenantId: req.auth!.tenantId, data: { event: 'POOL_UPDATED', poolId: pool.id, isPrimary } });
  broadcastSync({ type: 'admin:sync', tenantId: req.auth!.tenantId, data: { event: 'POOL_UPDATED', poolId: pool.id } });
  res.json(db.prepare('SELECT * FROM central_fund_pools WHERE id = ?').get(pool.id));
});

// ---------- VITE / STATIC FRONTEND + WEBSOCKET MULTI-DEVICE SERVER ----------
async function startServer() {
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (socket, req) => {
    try {
      const reqUrl = new URL(req.url || '/ws', 'http://localhost');
      const token = reqUrl.searchParams.get('token') || undefined;
      const ctx = authenticateToken(token);
      if (!ctx) {
        socket.close(4001, 'Unauthorized');
        return;
      }

      const clientId = uid('ws');
      registerWsClient({
        id: clientId,
        userId: ctx.userId,
        role: ctx.role,
        tenantId: ctx.tenantId,
        ws: socket,
      });

      const keepAlive = setInterval(() => {
        if (socket.readyState === 1) {
          socket.ping();
        }
      }, 25000);

      socket.on('close', () => {
        clearInterval(keepAlive);
        unregisterWsClient(clientId);
      });
      socket.on('error', () => {
        clearInterval(keepAlive);
        unregisterWsClient(clientId);
      });
    } catch {
      socket.close(4000, 'Bad request');
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build.');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`PRO MONEY Core Banking Server (HTTP + WebSocket) running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
