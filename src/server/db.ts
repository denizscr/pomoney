import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'promoney.db');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, keyHex] = stored.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT NOT NULL UNIQUE,
      primary_color TEXT NOT NULL,
      accent_color TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      customer_number TEXT UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      country TEXT NOT NULL,
      role TEXT NOT NULL,
      account_category TEXT NOT NULL,
      membership_tier TEXT NOT NULL DEFAULT 'Standard',
      kyc_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
      approval_status TEXT NOT NULL DEFAULT 'APPROVED',
      requested_company_name TEXT,
      requested_tax_id TEXT,
      national_id_number TEXT,
      passport_number TEXT,
      address_line TEXT,
      city TEXT,
      postal_code TEXT,
      identity_verified INTEGER NOT NULL DEFAULT 0,
      passport_verified INTEGER NOT NULL DEFAULT 0,
      address_verified INTEGER NOT NULL DEFAULT 0,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      mfa_enabled INTEGER NOT NULL DEFAULT 0,
      passkey_count INTEGER NOT NULL DEFAULT 0,
      high_value_alerts_enabled INTEGER NOT NULL DEFAULT 1,
      high_value_alert_threshold REAL NOT NULL DEFAULT 5000,
      biometric_enabled INTEGER NOT NULL DEFAULT 0,
      failed_login_attempts INTEGER NOT NULL DEFAULT 0,
      is_locked INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      lock_reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      device_label TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      business_id TEXT,
      account_number TEXT NOT NULL UNIQUE,
      iban TEXT NOT NULL UNIQUE,
      bic TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      currency TEXT NOT NULL,
      available_balance REAL NOT NULL DEFAULT 0,
      ledger_balance REAL NOT NULL DEFAULT 0,
      blocked_amount REAL NOT NULL DEFAULT 0,
      pending_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      is_sandbox INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS central_fund_pools (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      currency TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      segregated INTEGER NOT NULL DEFAULT 1,
      custodian_status TEXT NOT NULL,
      bank_name TEXT,
      iban TEXT,
      bic TEXT,
      is_primary_clearing INTEGER NOT NULL DEFAULT 0,
      routing_mode TEXT NOT NULL DEFAULT 'STANDBY',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      from_account_id TEXT,
      to_account_id TEXT,
      counterparty_name TEXT NOT NULL,
      counterparty_iban TEXT,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL,
      direction TEXT NOT NULL,
      status TEXT NOT NULL,
      reference TEXT NOT NULL,
      source TEXT NOT NULL,
      authorization_code TEXT NOT NULL,
      is_sandbox INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      account_id TEXT,
      pool_id TEXT,
      entry_type TEXT NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT')),
      amount REAL NOT NULL CHECK (amount >= 0),
      currency TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    );

    CREATE TRIGGER IF NOT EXISTS trg_ledger_no_update
    BEFORE UPDATE ON ledger_entries
    BEGIN
      SELECT RAISE(ABORT, 'Immutable ledger: updates are prohibited. Post a reversing entry.');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_ledger_no_delete
    BEFORE DELETE ON ledger_entries
    BEGIN
      SELECT RAISE(ABORT, 'Immutable ledger: deletions are prohibited.');
    END;

    CREATE TABLE IF NOT EXISTS beneficiaries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      iban TEXT NOT NULL,
      bic TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      currency TEXT NOT NULL,
      country TEXT NOT NULL,
      is_trusted INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS scheduled_transfers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      from_account_id TEXT NOT NULL,
      beneficiary_name TEXT NOT NULL,
      beneficiary_iban TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      frequency TEXT NOT NULL,
      next_run_date TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      holder_name TEXT NOT NULL,
      pan_formatted TEXT,
      last4 TEXT NOT NULL,
      cvv_code TEXT,
      issuer_label TEXT,
      credit_limit REAL NOT NULL DEFAULT 0,
      expiry TEXT NOT NULL,
      scheme TEXT NOT NULL,
      product_type TEXT NOT NULL,
      design_variant TEXT NOT NULL,
      status TEXT NOT NULL,
      online_enabled INTEGER NOT NULL DEFAULT 1,
      contactless_enabled INTEGER NOT NULL DEFAULT 1,
      atm_enabled INTEGER NOT NULL DEFAULT 1,
      daily_limit REAL NOT NULL,
      monthly_limit REAL NOT NULL,
      spent_today REAL NOT NULL DEFAULT 0,
      spent_month REAL NOT NULL DEFAULT 0,
      delivery_status TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      is_sandbox INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS atms (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      location TEXT NOT NULL,
      city TEXT NOT NULL,
      country TEXT NOT NULL,
      status TEXT NOT NULL,
      daily_limit REAL NOT NULL,
      fee_percent REAL NOT NULL,
      supported_schemes_json TEXT NOT NULL,
      last_diagnostic TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fx_rates (
      pair TEXT PRIMARY KEY,
      base TEXT NOT NULL,
      quote TEXT NOT NULL,
      bid REAL NOT NULL,
      ask REAL NOT NULL,
      mid REAL NOT NULL,
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS savings_products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      currency TEXT NOT NULL,
      apy_percent REAL NOT NULL,
      term_days INTEGER NOT NULL,
      min_amount REAL NOT NULL,
      regulatory_note TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS savings_positions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      currency TEXT NOT NULL,
      principal REAL NOT NULL,
      accrued_interest REAL NOT NULL DEFAULT 0,
      apy_percent REAL NOT NULL,
      maturity_date TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      product_type TEXT NOT NULL,
      principal_amount REAL NOT NULL,
      outstanding_balance REAL NOT NULL,
      apr_percent REAL NOT NULL,
      term_months INTEGER NOT NULL,
      monthly_installment REAL NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      next_due_date TEXT NOT NULL,
      funding_source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      company_name TEXT NOT NULL,
      registration_number TEXT NOT NULL,
      tax_id TEXT NOT NULL,
      country TEXT NOT NULL,
      kyb_status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS business_members (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      role_title TEXT NOT NULL,
      permissions_json TEXT NOT NULL,
      approval_limit REAL NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS business_invoices (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      client_name TEXT NOT NULL,
      client_email TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS merchants (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      business_name TEXT NOT NULL,
      mcc TEXT NOT NULL,
      country TEXT NOT NULL,
      settlement_currency TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      acquirer_status TEXT NOT NULL,
      volume_30d REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pos_terminals (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      owner_user_id TEXT,
      serial_number TEXT NOT NULL UNIQUE,
      model TEXT NOT NULL,
      location_name TEXT NOT NULL,
      status TEXT NOT NULL,
      terminal_mode TEXT NOT NULL DEFAULT 'HYBRID',
      approval_status TEXT NOT NULL DEFAULT 'APPROVED',
      online_enabled INTEGER NOT NULL DEFAULT 1,
      offline_enabled INTEGER NOT NULL DEFAULT 0,
      offline_floor_limit REAL NOT NULL DEFAULT 2500,
      offline_queued_count INTEGER NOT NULL DEFAULT 0,
      offline_queued_amount REAL NOT NULL DEFAULT 0,
      approved_by TEXT,
      approved_at TEXT,
      supports_contactless INTEGER NOT NULL DEFAULT 1,
      supports_qr INTEGER NOT NULL DEFAULT 1,
      supports_offline_rules INTEGER NOT NULL DEFAULT 0,
      last_heartbeat TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offline_pos_queue (
      id TEXT PRIMARY KEY,
      terminal_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      card_last4 TEXT NOT NULL,
      card_scheme TEXT NOT NULL,
      reference TEXT NOT NULL,
      auth_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED_OFFLINE',
      created_at TEXT NOT NULL,
      settled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS user_entitlements (
      user_id TEXT PRIMARY KEY,
      allow_pos_online INTEGER NOT NULL DEFAULT 0,
      allow_pos_offline INTEGER NOT NULL DEFAULT 0,
      allow_swift INTEGER NOT NULL DEFAULT 1,
      allow_credit_cards INTEGER NOT NULL DEFAULT 1,
      allow_debit_cards INTEGER NOT NULL DEFAULT 1,
      allow_card_topup INTEGER NOT NULL DEFAULT 1,
      allow_loans INTEGER NOT NULL DEFAULT 1,
      allow_qr_bills INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS system_operation_settings (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      fee_fixed REAL NOT NULL DEFAULT 0,
      fee_percent REAL NOT NULL DEFAULT 0,
      max_amount REAL NOT NULL DEFAULT 100000,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_links (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      requires_3ds INTEGER NOT NULL DEFAULT 1,
      checkout_code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS membership_plans (
      tier TEXT PRIMARY KEY,
      monthly_price_eur REAL NOT NULL,
      daily_transfer_limit_eur REAL NOT NULL,
      fx_monthly_free_allowance_eur REAL NOT NULL,
      fx_markup_bps INTEGER NOT NULL,
      card_tier_label TEXT NOT NULL,
      support_sla TEXT NOT NULL,
      features_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kyc_kyb_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      subject_name TEXT NOT NULL,
      record_type TEXT NOT NULL,
      document_type TEXT NOT NULL,
      document_last4 TEXT NOT NULL,
      pep_check TEXT NOT NULL,
      sanctions_check TEXT NOT NULL,
      risk_score INTEGER NOT NULL,
      status TEXT NOT NULL,
      reviewed_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS aml_fraud_cases (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      transaction_id TEXT,
      case_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      risk_score INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      category TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'TICKET',
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      severity TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      environment TEXT NOT NULL,
      status TEXT NOT NULL,
      details TEXT NOT NULL,
      last_checked TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dual_approvals (
      id TEXT PRIMARY KEY,
      requested_by_user_id TEXT NOT NULL,
      requested_by_email TEXT NOT NULL,
      action_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      approved_by_user_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      environment TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      url TEXT NOT NULL,
      events_json TEXT NOT NULL,
      status TEXT NOT NULL,
      last_delivery_status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS identity_verifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      verification_type TEXT NOT NULL,
      document_number TEXT,
      issuing_country TEXT,
      expiry_date TEXT,
      address_full TEXT,
      city TEXT,
      postal_code TEXT,
      phone_number TEXT,
      proof_reference TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      rejection_reason TEXT,
      verified_by TEXT,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS phone_otp_challenges (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ledger_tx ON ledger_entries(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_verif_user ON identity_verifications(user_id, verification_type);
    CREATE INDEX IF NOT EXISTS idx_otp_user ON phone_otp_challenges(user_id, created_at DESC);
  `);

  // Safe schema migration for existing SQLite databases
  const userCols = (db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map((c) => c.name);
  if (!userCols.includes('customer_number')) {
    db.exec('ALTER TABLE users ADD COLUMN customer_number TEXT;');
  }
  if (!userCols.includes('approval_status')) {
    db.exec("ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'APPROVED';");
  }
  if (!userCols.includes('requested_company_name')) {
    db.exec('ALTER TABLE users ADD COLUMN requested_company_name TEXT;');
  }
  if (!userCols.includes('requested_tax_id')) {
    db.exec('ALTER TABLE users ADD COLUMN requested_tax_id TEXT;');
  }
  if (!userCols.includes('national_id_number')) {
    db.exec('ALTER TABLE users ADD COLUMN national_id_number TEXT;');
  }
  if (!userCols.includes('passport_number')) {
    db.exec('ALTER TABLE users ADD COLUMN passport_number TEXT;');
  }
  if (!userCols.includes('address_line')) {
    db.exec('ALTER TABLE users ADD COLUMN address_line TEXT;');
  }
  if (!userCols.includes('city')) {
    db.exec('ALTER TABLE users ADD COLUMN city TEXT;');
  }
  if (!userCols.includes('postal_code')) {
    db.exec('ALTER TABLE users ADD COLUMN postal_code TEXT;');
  }
  if (!userCols.includes('identity_verified')) {
    db.exec('ALTER TABLE users ADD COLUMN identity_verified INTEGER NOT NULL DEFAULT 0;');
  }
  if (!userCols.includes('passport_verified')) {
    db.exec('ALTER TABLE users ADD COLUMN passport_verified INTEGER NOT NULL DEFAULT 0;');
  }
  if (!userCols.includes('address_verified')) {
    db.exec('ALTER TABLE users ADD COLUMN address_verified INTEGER NOT NULL DEFAULT 0;');
  }
  if (!userCols.includes('phone_verified')) {
    db.exec('ALTER TABLE users ADD COLUMN phone_verified INTEGER NOT NULL DEFAULT 0;');
  }
  if (!userCols.includes('high_value_alerts_enabled')) {
    db.exec('ALTER TABLE users ADD COLUMN high_value_alerts_enabled INTEGER NOT NULL DEFAULT 1;');
  }
  if (!userCols.includes('high_value_alert_threshold')) {
    db.exec('ALTER TABLE users ADD COLUMN high_value_alert_threshold REAL NOT NULL DEFAULT 5000;');
  }
  if (!userCols.includes('biometric_enabled')) {
    db.exec('ALTER TABLE users ADD COLUMN biometric_enabled INTEGER NOT NULL DEFAULT 0;');
  }
  if (!userCols.includes('failed_login_attempts')) {
    db.exec('ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;');
  }
  if (!userCols.includes('is_locked')) {
    db.exec('ALTER TABLE users ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0;');
  }
  if (!userCols.includes('locked_until')) {
    db.exec('ALTER TABLE users ADD COLUMN locked_until TEXT;');
  }
  if (!userCols.includes('lock_reason')) {
    db.exec('ALTER TABLE users ADD COLUMN lock_reason TEXT;');
  }

  const poolCols = (db.prepare('PRAGMA table_info(central_fund_pools)').all() as Array<{ name: string }>).map((c) => c.name);
  if (!poolCols.includes('bank_name')) {
    db.exec('ALTER TABLE central_fund_pools ADD COLUMN bank_name TEXT;');
  }
  if (!poolCols.includes('iban')) {
    db.exec('ALTER TABLE central_fund_pools ADD COLUMN iban TEXT;');
  }
  if (!poolCols.includes('bic')) {
    db.exec('ALTER TABLE central_fund_pools ADD COLUMN bic TEXT;');
  }
  if (!poolCols.includes('is_primary_clearing')) {
    db.exec('ALTER TABLE central_fund_pools ADD COLUMN is_primary_clearing INTEGER NOT NULL DEFAULT 0;');
  }
  if (!poolCols.includes('routing_mode')) {
    db.exec("ALTER TABLE central_fund_pools ADD COLUMN routing_mode TEXT NOT NULL DEFAULT 'STANDBY';");
  }

  const ticketCols = (db.prepare('PRAGMA table_info(support_tickets)').all() as Array<{ name: string }>).map((c) => c.name);
  if (!ticketCols.includes('channel')) {
    db.exec("ALTER TABLE support_tickets ADD COLUMN channel TEXT NOT NULL DEFAULT 'TICKET';");
  }

  const cardCols = (db.prepare('PRAGMA table_info(cards)').all() as Array<{ name: string }>).map((c) => c.name);
  if (!cardCols.includes('pan_formatted')) {
    db.exec('ALTER TABLE cards ADD COLUMN pan_formatted TEXT;');
  }
  if (!cardCols.includes('cvv_code')) {
    db.exec('ALTER TABLE cards ADD COLUMN cvv_code TEXT;');
  }
  if (!cardCols.includes('issuer_label')) {
    db.exec('ALTER TABLE cards ADD COLUMN issuer_label TEXT;');
  }
  if (!cardCols.includes('credit_limit')) {
    db.exec('ALTER TABLE cards ADD COLUMN credit_limit REAL NOT NULL DEFAULT 0;');
  }

  const posCols = (db.prepare('PRAGMA table_info(pos_terminals)').all() as Array<{ name: string }>).map((c) => c.name);
  if (!posCols.includes('owner_user_id')) {
    db.exec('ALTER TABLE pos_terminals ADD COLUMN owner_user_id TEXT;');
  }
  if (!posCols.includes('terminal_mode')) {
    db.exec("ALTER TABLE pos_terminals ADD COLUMN terminal_mode TEXT NOT NULL DEFAULT 'HYBRID';");
  }
  if (!posCols.includes('approval_status')) {
    db.exec("ALTER TABLE pos_terminals ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'APPROVED';");
  }
  if (!posCols.includes('online_enabled')) {
    db.exec('ALTER TABLE pos_terminals ADD COLUMN online_enabled INTEGER NOT NULL DEFAULT 1;');
  }
  if (!posCols.includes('offline_enabled')) {
    db.exec('ALTER TABLE pos_terminals ADD COLUMN offline_enabled INTEGER NOT NULL DEFAULT 0;');
  }
  if (!posCols.includes('offline_floor_limit')) {
    db.exec('ALTER TABLE pos_terminals ADD COLUMN offline_floor_limit REAL NOT NULL DEFAULT 2500;');
  }
  if (!posCols.includes('offline_queued_count')) {
    db.exec('ALTER TABLE pos_terminals ADD COLUMN offline_queued_count INTEGER NOT NULL DEFAULT 0;');
  }
  if (!posCols.includes('offline_queued_amount')) {
    db.exec('ALTER TABLE pos_terminals ADD COLUMN offline_queued_amount REAL NOT NULL DEFAULT 0;');
  }
  if (!posCols.includes('approved_by')) {
    db.exec('ALTER TABLE pos_terminals ADD COLUMN approved_by TEXT;');
  }
  if (!posCols.includes('approved_at')) {
    db.exec('ALTER TABLE pos_terminals ADD COLUMN approved_at TEXT;');
  }

  ensureSystemOperationSettingsSeeded();

  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (userCount.cnt === 0) {
    seedInitialData();
  } else {
    // Backfill customer_number for any pre-existing rows missing it
    const missingCust = db.prepare('SELECT id FROM users WHERE customer_number IS NULL').all() as Array<{ id: string }>;
    missingCust.forEach((u, idx) => {
      const custNum = String(100001 + idx + Math.floor(Math.random() * 800));
      db.prepare('UPDATE users SET customer_number = ? WHERE id = ?').run(custNum, u.id);
    });
  }

  ensureSupportSpecialistSeeded();
  ensurePrimaryClearingPoolSeeded();
}

export interface UserEntitlements {
  userId: string;
  allowPosOnline: boolean;
  allowPosOffline: boolean;
  allowSwift: boolean;
  allowCreditCards: boolean;
  allowDebitCards: boolean;
  allowCardTopup: boolean;
  allowLoans: boolean;
  allowQrBills: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

export interface SystemOperationSetting {
  key: string;
  label: string;
  enabled: boolean;
  feeFixed: number;
  feePercent: number;
  maxAmount: number;
  updatedBy: string | null;
  updatedAt: string;
}

const DEFAULT_OPERATION_SETTINGS: Array<{
  key: string;
  label: string;
  enabled: number;
  feeFixed: number;
  feePercent: number;
  maxAmount: number;
}> = [
  { key: 'POS_ONLINE', label: 'Online POS Tahsilat (EMV/QR)', enabled: 1, feeFixed: 0, feePercent: 1.49, maxAmount: 250000 },
  { key: 'POS_OFFLINE', label: 'Offline POS (Store & Forward)', enabled: 1, feeFixed: 0, feePercent: 1.75, maxAmount: 5000 },
  { key: 'LOANS', label: 'Kredi Başvurusu & Finansman', enabled: 1, feeFixed: 0, feePercent: 0, maxAmount: 100000 },
  { key: 'CARD_TOPUP', label: 'Kart ile Bakiye Yükleme (3DS)', enabled: 1, feeFixed: 0, feePercent: 0.75, maxAmount: 50000 },
  { key: 'SWIFT_TRANSFER', label: 'Uluslararası SWIFT Transfer', enabled: 1, feeFixed: 12, feePercent: 0, maxAmount: 250000 },
  { key: 'SEPA_INSTANT', label: 'SEPA Instant Anlık Transfer', enabled: 1, feeFixed: 0.5, feePercent: 0, maxAmount: 100000 },
  { key: 'FX_EXCHANGE', label: 'Döviz Alım / Satım (FX)', enabled: 1, feeFixed: 0, feePercent: 0.15, maxAmount: 500000 },
  { key: 'AML_THRESHOLD', label: 'AML Yüksek Tutar İnceleme Eşiği', enabled: 1, feeFixed: 0, feePercent: 0, maxAmount: 10000 },
  { key: 'HIGH_VALUE_ALERT_DEFAULT', label: 'Varsayılan Push Uyarı Eşiği', enabled: 1, feeFixed: 0, feePercent: 0, maxAmount: 5000 },
  { key: 'MAINTENANCE_MODE', label: 'Sistem Bakım Modu (Transferleri Durdur)', enabled: 0, feeFixed: 0, feePercent: 0, maxAmount: 0 },
];

function ensureSystemOperationSettingsSeeded() {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO system_operation_settings (key, label, enabled, fee_fixed, fee_percent, max_amount, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'SYSTEM', ?)`
  );
  for (const item of DEFAULT_OPERATION_SETTINGS) {
    stmt.run(item.key, item.label, item.enabled, item.feeFixed, item.feePercent, item.maxAmount, now);
  }
}

const ADMIN_ROLE_SET = new Set([
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

function defaultEntitlementsForUser(userId: string): UserEntitlements {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
  const role = user?.role || 'INDIVIDUAL_CUSTOMER';
  const isAdmin = ADMIN_ROLE_SET.has(role);
  const isMerchant = role === 'MERCHANT';
  return {
    userId,
    allowPosOnline: isAdmin || isMerchant,
    allowPosOffline: isAdmin || isMerchant,
    allowSwift: true,
    allowCreditCards: true,
    allowDebitCards: true,
    allowCardTopup: true,
    allowLoans: true,
    allowQrBills: true,
    updatedBy: null,
    updatedAt: new Date().toISOString(),
  };
}

export function getUserEntitlements(userId: string): UserEntitlements {
  const row = db.prepare('SELECT * FROM user_entitlements WHERE user_id = ?').get(userId) as any;
  if (!row) {
    return defaultEntitlementsForUser(userId);
  }
  return {
    userId: row.user_id,
    allowPosOnline: Boolean(row.allow_pos_online),
    allowPosOffline: Boolean(row.allow_pos_offline),
    allowSwift: Boolean(row.allow_swift),
    allowCreditCards: Boolean(row.allow_credit_cards),
    allowDebitCards: Boolean(row.allow_debit_cards),
    allowCardTopup: Boolean(row.allow_card_topup),
    allowLoans: Boolean(row.allow_loans),
    allowQrBills: Boolean(row.allow_qr_bills),
    updatedBy: row.updated_by || null,
    updatedAt: row.updated_at,
  };
}

export function upsertUserEntitlements(
  userId: string,
  patch: Partial<Omit<UserEntitlements, 'userId' | 'updatedBy' | 'updatedAt'>>,
  actorUserId: string
): UserEntitlements {
  const current = getUserEntitlements(userId);
  const next: UserEntitlements = {
    userId,
    allowPosOnline: patch.allowPosOnline !== undefined ? Boolean(patch.allowPosOnline) : current.allowPosOnline,
    allowPosOffline: patch.allowPosOffline !== undefined ? Boolean(patch.allowPosOffline) : current.allowPosOffline,
    allowSwift: patch.allowSwift !== undefined ? Boolean(patch.allowSwift) : current.allowSwift,
    allowCreditCards: patch.allowCreditCards !== undefined ? Boolean(patch.allowCreditCards) : current.allowCreditCards,
    allowDebitCards: patch.allowDebitCards !== undefined ? Boolean(patch.allowDebitCards) : current.allowDebitCards,
    allowCardTopup: patch.allowCardTopup !== undefined ? Boolean(patch.allowCardTopup) : current.allowCardTopup,
    allowLoans: patch.allowLoans !== undefined ? Boolean(patch.allowLoans) : current.allowLoans,
    allowQrBills: patch.allowQrBills !== undefined ? Boolean(patch.allowQrBills) : current.allowQrBills,
    updatedBy: actorUserId,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO user_entitlements (
       user_id, allow_pos_online, allow_pos_offline, allow_swift, allow_credit_cards,
       allow_debit_cards, allow_card_topup, allow_loans, allow_qr_bills, updated_by, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       allow_pos_online = excluded.allow_pos_online,
       allow_pos_offline = excluded.allow_pos_offline,
       allow_swift = excluded.allow_swift,
       allow_credit_cards = excluded.allow_credit_cards,
       allow_debit_cards = excluded.allow_debit_cards,
       allow_card_topup = excluded.allow_card_topup,
       allow_loans = excluded.allow_loans,
       allow_qr_bills = excluded.allow_qr_bills,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`
  ).run(
    next.userId,
    next.allowPosOnline ? 1 : 0,
    next.allowPosOffline ? 1 : 0,
    next.allowSwift ? 1 : 0,
    next.allowCreditCards ? 1 : 0,
    next.allowDebitCards ? 1 : 0,
    next.allowCardTopup ? 1 : 0,
    next.allowLoans ? 1 : 0,
    next.allowQrBills ? 1 : 0,
    next.updatedBy,
    next.updatedAt
  );

  return next;
}

export function ensureMerchantForUser(userId: string) {
  const existing = db.prepare('SELECT * FROM merchants WHERE user_id = ?').get(userId) as any;
  if (existing) return existing;

  const user = db
    .prepare('SELECT id, full_name, country, requested_company_name FROM users WHERE id = ?')
    .get(userId) as { id: string; full_name: string; country: string; requested_company_name?: string | null } | undefined;

  const id = `mer_${crypto.randomBytes(6).toString('hex')}`;
  const businessName = user?.requested_company_name || (user?.full_name ? `${user.full_name} POS` : 'PRO MONEY Merchant');
  const country = user?.country || 'TR';

  db.prepare(
    `INSERT INTO merchants (id, user_id, business_name, mcc, country, settlement_currency, verification_status, acquirer_status, volume_30d)
     VALUES (?, ?, ?, '5999', ?, 'TRY', 'VERIFIED', 'SANDBOX_ACQUIRER (Requires Live Acquiring Contract)', 0)`
  ).run(id, userId, businessName, country);

  return db.prepare('SELECT * FROM merchants WHERE id = ?').get(id) as any;
}

function mapOperationSettingRow(row: any): SystemOperationSetting {
  return {
    key: row.key,
    label: row.label,
    enabled: Boolean(row.enabled),
    feeFixed: Number(row.fee_fixed),
    feePercent: Number(row.fee_percent),
    maxAmount: Number(row.max_amount),
    updatedBy: row.updated_by || null,
    updatedAt: row.updated_at,
  };
}

export function getSystemOperationSettings(): SystemOperationSetting[] {
  ensureSystemOperationSettingsSeeded();
  const rows = db.prepare('SELECT * FROM system_operation_settings ORDER BY key ASC').all() as any[];
  return rows.map(mapOperationSettingRow);
}

export function upsertSystemOperationSetting(
  key: string,
  patch: { enabled?: boolean; feeFixed?: number; feePercent?: number; maxAmount?: number; label?: string },
  actorUserId: string
): SystemOperationSetting {
  ensureSystemOperationSettingsSeeded();
  const existing = db.prepare('SELECT * FROM system_operation_settings WHERE key = ?').get(key) as any;
  if (!existing) {
    throw new Error(`System operation setting '${key}' not found.`);
  }

  const enabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled;
  const feeFixed = patch.feeFixed !== undefined && Number.isFinite(Number(patch.feeFixed)) ? Math.max(0, Number(patch.feeFixed)) : existing.fee_fixed;
  const feePercent = patch.feePercent !== undefined && Number.isFinite(Number(patch.feePercent)) ? Math.max(0, Number(patch.feePercent)) : existing.fee_percent;
  const maxAmount = patch.maxAmount !== undefined && Number.isFinite(Number(patch.maxAmount)) ? Math.max(0, Number(patch.maxAmount)) : existing.max_amount;
  const label = patch.label !== undefined ? String(patch.label).trim() || existing.label : existing.label;
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE system_operation_settings
     SET label = ?, enabled = ?, fee_fixed = ?, fee_percent = ?, max_amount = ?, updated_by = ?, updated_at = ?
     WHERE key = ?`
  ).run(label, enabled, feeFixed, feePercent, maxAmount, actorUserId, now, key);

  return mapOperationSettingRow(db.prepare('SELECT * FROM system_operation_settings WHERE key = ?').get(key));
}

const CORE_TABLES = [
  'users',
  'accounts',
  'transactions',
  'ledger_entries',
  'cards',
  'central_fund_pools',
  'identity_verifications',
  'phone_otp_challenges',
  'kyc_kyb_records',
  'aml_fraud_cases',
  'businesses',
  'merchants',
  'pos_terminals',
  'offline_pos_queue',
  'user_entitlements',
  'system_operation_settings',
  'audit_logs',
  'sessions',
] as const;

export function getDatabaseTableStats(): Array<{ table: string; count: number }> {
  return CORE_TABLES.map((table) => {
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
    return { table, count: Number(row?.cnt || 0) };
  });
}

function ensureSupportSpecialistSeeded() {
  const existing = db.prepare("SELECT id FROM users WHERE id = 'usr_support_1' OR LOWER(email) = 'destek@promoney.test'").get();
  if (existing) return;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO users (
       id, tenant_id, customer_number, email, password_hash, full_name, phone, country,
       role, account_category, membership_tier, kyc_status, approval_status,
       identity_verified, passport_verified, address_verified, phone_verified,
       mfa_enabled, passkey_count, created_at
     ) VALUES (?, 'tenant_promoney', '900003', 'destek@promoney.test', ?, 'Merve Öztürk (Canlı Destek)', '+90 850 555 0903', 'TR', 'CUSTOMER_SUPPORT', 'Employee', 'Corporate', 'VERIFIED', 'APPROVED', 1, 1, 1, 1, 1, 1, ?)`
  ).run('usr_support_1', hashPassword('ProMoney2026!'), now);
}

function ensurePrimaryClearingPoolSeeded() {
  const hasPrimary = db.prepare('SELECT id FROM central_fund_pools WHERE is_primary_clearing = 1 LIMIT 1').get();
  if (!hasPrimary) {
    const poolA = db.prepare("SELECT id FROM central_fund_pools WHERE id = 'pool_A'").get();
    if (poolA) {
      db.prepare(
        `UPDATE central_fund_pools
         SET is_primary_clearing = 1,
             routing_mode = 'ALL',
             bank_name = COALESCE(bank_name, 'PRO MONEY Safeguarding Partner Bank'),
             iban = COALESCE(iban, 'DE89500105175407000001'),
             bic = COALESCE(bic, 'PMNYDEFFXXX')
         WHERE id = 'pool_A'`
      ).run();
    }
  }
  db.prepare(
    `UPDATE central_fund_pools
     SET bank_name = COALESCE(bank_name, 'PRO MONEY Internal Treasury'),
         routing_mode = CASE WHEN is_primary_clearing = 1 THEN COALESCE(NULLIF(routing_mode, 'STANDBY'), 'ALL') ELSE COALESCE(routing_mode, 'STANDBY') END`
  ).run();
}

export function getPrimaryClearingPool(direction: 'IN' | 'OUT' = 'IN'): {
  id: string;
  code: string;
  name: string;
  bankName: string;
  iban: string;
  bic: string;
  routingMode: string;
} {
  const preferredModes = direction === 'IN' ? "('ALL', 'INFLOW')" : "('ALL', 'OUTFLOW')";
  let row = db
    .prepare(
      `SELECT * FROM central_fund_pools
       WHERE is_primary_clearing = 1 AND routing_mode IN ${preferredModes}
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get() as any;

  if (!row) {
    row = db.prepare(`SELECT * FROM central_fund_pools WHERE is_primary_clearing = 1 ORDER BY updated_at DESC LIMIT 1`).get() as any;
  }
  if (!row) {
    const fallbackId = direction === 'IN' ? 'pool_A' : 'pool_D';
    row = db.prepare(`SELECT * FROM central_fund_pools WHERE id = ?`).get(fallbackId) as any;
  }
  return {
    id: row?.id || (direction === 'IN' ? 'pool_A' : 'pool_D'),
    code: row?.code || (direction === 'IN' ? 'A' : 'D'),
    name: row?.name || 'Safeguarded Customer Funds',
    bankName: row?.bank_name || 'PRO MONEY Partner Clearing Bank',
    iban: row?.iban || 'DE89500105175407000001',
    bic: row?.bic || 'PMNYDEFFXXX',
    routingMode: row?.routing_mode || 'ALL',
  };
}

function sqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
  if (typeof val === 'boolean') return val ? '1' : '0';
  return `'${String(val).replace(/'/g, "''")}'`;
}

export function exportFullDatabaseSql(): string {
  const lines: string[] = [
    '-- ============================================================================',
    `-- PRO MONEY Core Banking — Full SQL Snapshot (${new Date().toISOString()})`,
    '-- Compatible with SQLite 3 / PostgreSQL (standard INSERT statements)',
    '-- ============================================================================',
    '',
  ];

  const tables = db
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid ASC`)
    .all() as Array<{ name: string; sql: string }>;

  for (const tbl of tables) {
    lines.push(`-- Table: ${tbl.name}`);
    lines.push(`${tbl.sql};`);
    const rows = db.prepare(`SELECT * FROM ${tbl.name}`).all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = cols.map((c) => {
        if (tbl.name === 'sessions' && c === 'token_hash') return sqlLiteral('[REDACTED_SESSION_HASH]');
        return sqlLiteral(row[c]);
      });
      lines.push(`INSERT INTO ${tbl.name} (${cols.join(', ')}) VALUES (${vals.join(', ')});`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function seedInitialData() {
  const now = new Date().toISOString();
  const demoPass = hashPassword('ProMoney2026!');

  // 1. Default PRO MONEY Tenant + White-Label Sample Tenant
  db.prepare(
    `INSERT INTO tenants (id, name, domain, primary_color, accent_color, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('tenant_promoney', 'PRO MONEY', 'app.promoney.bank', '#FFFFFF', '#F97316', 'ACTIVE', now);

  db.prepare(
    `INSERT INTO tenants (id, name, domain, primary_color, accent_color, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('tenant_nordic_wl', 'PRO MONEY White-Label Partner', 'partner.promoney.bank', '#111827', '#D4AF37', 'SANDBOX', now);

  // 2. Users across all separated banking portals + Demo Accounts
  const insertUser = db.prepare(
    `INSERT INTO users (
       id, tenant_id, customer_number, email, password_hash, full_name, phone, country,
       role, account_category, membership_tier, kyc_status, approval_status,
       requested_company_name, requested_tax_id,
       national_id_number, passport_number, address_line, city, postal_code,
       identity_verified, passport_verified, address_verified, phone_verified,
       mfa_enabled, passkey_count, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertUser.run(
    'usr_customer_1',
    'tenant_promoney',
    '100001',
    'deniz.kaya@promoney.test',
    demoPass,
    'Deniz Kaya',
    '+90 532 555 0192',
    'TR',
    'INDIVIDUAL_CUSTOMER',
    'Personal',
    'Platinum',
    'VERIFIED',
    'APPROVED',
    null,
    null,
    '24681357902',
    'U24908142',
    'Abdi İpekçi Cad. No:42 D:8, Nişantaşı',
    'İstanbul',
    '34367',
    1,
    1,
    1,
    1,
    1,
    1,
    now
  );

  insertUser.run(
    'usr_customer_2',
    'tenant_promoney',
    '100002',
    'elena.vance@promoney.test',
    demoPass,
    'Elena Vance',
    '+44 7700 900412',
    'GB',
    'INDIVIDUAL_CUSTOMER',
    'Personal',
    'Gold',
    'VERIFIED',
    'APPROVED',
    null,
    null,
    'UK99401288',
    '541882910',
    '14 Canary Wharf Jubilee Place',
    'London',
    'E14 5NY',
    1,
    1,
    1,
    1,
    0,
    0,
    now
  );

  insertUser.run(
    'usr_business_1',
    'tenant_promoney',
    '200001',
    'finance@atelier-nova.test',
    demoPass,
    'Kerem Arslan',
    '+49 170 555 0144',
    'DE',
    'BUSINESS_MANAGER',
    'Business',
    'Business',
    'VERIFIED',
    'APPROVED',
    'Atelier Nova GmbH',
    'DE319847221',
    '33819044112',
    'C88192044',
    'Taunusanlage 12',
    'Frankfurt am Main',
    '60325',
    1,
    1,
    1,
    1,
    1,
    1,
    now
  );

  insertUser.run(
    'usr_merchant_1',
    'tenant_promoney',
    '300001',
    'pos@velvetroastery.test',
    demoPass,
    'Selin Demir',
    '+90 212 555 0177',
    'TR',
    'MERCHANT',
    'Merchant',
    'Business',
    'VERIFIED',
    'APPROVED',
    'Velvet Roastery & Cafe',
    'TR319847001',
    '41290837416',
    'U19028374',
    'Kemankeş Karamustafa Paşa Mah. No:18, Karaköy',
    'İstanbul',
    '34425',
    1,
    1,
    1,
    1,
    1,
    0,
    now
  );

  insertUser.run(
    'usr_admin_1',
    'tenant_promoney',
    '900001',
    'admin@promoney.test',
    demoPass,
    'Aylin Yilmaz',
    '+44 20 7946 0821',
    'GB',
    'SUPER_ADMIN',
    'Administrator',
    'Black',
    'VERIFIED',
    'APPROVED',
    null,
    null,
    '11029384756',
    'P99102938',
    '22 Bishopsgate Level 18',
    'London',
    'EC2N 4BQ',
    1,
    1,
    1,
    1,
    1,
    2,
    now
  );

  insertUser.run(
    'usr_compliance_1',
    'tenant_promoney',
    '900002',
    'compliance@promoney.test',
    demoPass,
    'Marcus Weber',
    '+41 44 580 2210',
    'CH',
    'COMPLIANCE_OFFICER',
    'Employee',
    'Corporate',
    'VERIFIED',
    'APPROVED',
    null,
    null,
    'CH77192837',
    'X55102938',
    'Bahnhofstrasse 44',
    'Zurich',
    '8001',
    1,
    1,
    1,
    1,
    1,
    1,
    now
  );

  // Dedicated Turkish Demo Users across all portals
  insertUser.run(
    'usr_demo_personal',
    'tenant_promoney',
    '100010',
    'demo.bireysel@promoney.test',
    demoPass,
    'Emre Demir (Demo Bireysel)',
    '+90 532 100 0010',
    'TR',
    'INDIVIDUAL_CUSTOMER',
    'Personal',
    'Gold',
    'VERIFIED',
    'APPROVED',
    null,
    null,
    '19283746502',
    'U77102945',
    'Bağdat Caddesi No:214 D:5, Kadıköy',
    'İstanbul',
    '34728',
    1,
    1,
    1,
    1,
    1,
    1,
    now
  );

  insertUser.run(
    'usr_demo_business',
    'tenant_promoney',
    '200010',
    'demo.sirket@promoney.test',
    demoPass,
    'Zeynep Aksoy (Demo Şirket)',
    '+90 532 200 0010',
    'TR',
    'BUSINESS_MANAGER',
    'Business',
    'Business',
    'VERIFIED',
    'APPROVED',
    'Anadolu Teknoloji A.Ş.',
    'TR8841209512',
    '38475619204',
    'U55891204',
    'Büyükdere Cad. No:185 Levent',
    'İstanbul',
    '34394',
    1,
    1,
    1,
    1,
    1,
    1,
    now
  );

  insertUser.run(
    'usr_demo_merchant',
    'tenant_promoney',
    '300010',
    'demo.pos@promoney.test',
    demoPass,
    'Canberk Yılmaz (Demo POS)',
    '+90 532 300 0010',
    'TR',
    'MERCHANT',
    'Merchant',
    'Business',
    'PENDING',
    'APPROVED',
    'Marmara Gurme Market',
    'TR6620194810',
    '56473829108',
    'U31209874',
    'Atatürk Bulvarı No:94, Çankaya',
    'Ankara',
    '06420',
    1,
    0,
    1,
    1,
    0,
    0,
    now
  );

  insertUser.run(
    'usr_demo_admin',
    'tenant_promoney',
    '900010',
    'demo.admin@promoney.test',
    demoPass,
    'Hakan Çelik (Demo Yönetim)',
    '+90 532 900 0010',
    'TR',
    'SUPER_ADMIN',
    'Administrator',
    'Black',
    'VERIFIED',
    'APPROVED',
    null,
    null,
    '90128374650',
    'S88120394',
    'Maslak Finans Plaza K:14, Sarıyer',
    'İstanbul',
    '34398',
    1,
    1,
    1,
    1,
    1,
    1,
    now
  );

  // Sample applicants awaiting Management Approval & Verification Review
  insertUser.run(
    'usr_pending_1',
    'tenant_promoney',
    '100099',
    'burak.sahin@promoney.test',
    demoPass,
    'Burak Sahin',
    '+90 533 555 0188',
    'TR',
    'INDIVIDUAL_CUSTOMER',
    'Personal',
    'Standard',
    'PENDING',
    'PENDING_APPROVAL',
    null,
    null,
    '65748392014',
    'U44019283',
    'Cumhuriyet Mah. İstiklal Sk. No:12',
    'İzmir',
    '35220',
    0,
    0,
    0,
    0,
    0,
    0,
    now
  );

  insertUser.run(
    'usr_demo_pending',
    'tenant_promoney',
    '100100',
    'demo.onay@promoney.test',
    demoPass,
    'Elif Kara (Onay Bekleyen Demo)',
    '+90 532 100 0100',
    'TR',
    'INDIVIDUAL_CUSTOMER',
    'Personal',
    'Standard',
    'PENDING',
    'PENDING_APPROVAL',
    null,
    null,
    '74839201654',
    null,
    'Tunalı Hilmi Cad. No:64 D:3',
    'Ankara',
    '06680',
    0,
    0,
    0,
    0,
    0,
    0,
    now
  );

  // 3. 7 Segregated Central Fund Pools (A - G)
  const insertPool = db.prepare(
    `INSERT INTO central_fund_pools (id, code, name, category, currency, balance, segregated, custodian_status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertPool.run('pool_A', 'A', 'Safeguarded Customer Funds', 'Client Money Ring-Fenced Pool', 'EUR', 96450.00, 1, 'Sandbox Ledger — Requires Authorized Safeguarding Bank', now);
  insertPool.run('pool_B', 'B', 'Company Operational Funds', 'PRO MONEY Corporate OpEx', 'EUR', 450000.00, 1, 'Internal Corporate Treasury (Segregated)', now);
  insertPool.run('pool_C', 'C', 'Card Settlement Funds', 'Visa / Mastercard / TROY Clearing', 'EUR', 28400.00, 1, 'Sandbox — Requires BIN Sponsor Settlement Account', now);
  insertPool.run('pool_D', 'D', 'Payment Settlement Funds', 'POS & Payment Gateway Clearing', 'EUR', 42150.00, 1, 'Sandbox — Requires Acquirer Clearing Account', now);
  insertPool.run('pool_E', 'E', 'Credit / Lending Funds', 'PRO MONEY Credit Facility Pool', 'EUR', 300000.00, 1, 'Segregated Lending Capital (Never Client Funds)', now);
  insertPool.run('pool_F', 'F', 'Treasury and Liquidity', 'Multi-Currency FX Liquidity Reserve', 'EUR', 520000.00, 1, 'Sandbox Liquidity Buffer', now);
  insertPool.run('pool_G', 'G', 'Fees and Commissions', 'Platform Fee Revenue Account', 'EUR', 1420.50, 1, 'Internal Fee Recognition Ledger', now);

  // 4. Customer, Business, & Merchant Multi-Currency Accounts
  const insertAcc = db.prepare(
    `INSERT INTO accounts (id, tenant_id, user_id, business_id, account_number, iban, bic, type, label, currency, available_balance, ledger_balance, blocked_amount, pending_amount, status, is_sandbox, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  );

  // Deniz Kaya (Primary Personal Customer)
  insertAcc.run('acc_dk_try_6000', 'tenant_promoney', 'usr_customer_1', null, 'PM-10048290', 'TR120006100519786457846000', 'PMNYTRISXXX', 'PERSONAL', '6.000 TL Günlük Hesap', 'TRY', 6000.00, 6000.00, 0, 0, 'ACTIVE', now);
  insertAcc.run('acc_dk_eur', 'tenant_promoney', 'usr_customer_1', null, 'PM-10048291', 'DE89500105175407324931', 'PMNYDEFFXXX', 'PERSONAL', 'Main EUR Account', 'EUR', 24850.40, 25100.40, 0, 250.00, 'ACTIVE', now);
  insertAcc.run('acc_dk_usd', 'tenant_promoney', 'usr_customer_1', null, 'PM-10048292', 'US64PMNY00010048292001', 'PMNYUS33XXX', 'MULTI_CURRENCY', 'USD Global Wallet', 'USD', 12420.00, 12420.00, 0, 0, 'ACTIVE', now);
  insertAcc.run('acc_dk_try', 'tenant_promoney', 'usr_customer_1', null, 'PM-10048293', 'TR330006100519786457841326', 'PMNYTRISXXX', 'MULTI_CURRENCY', 'TRY Everyday Wallet', 'TRY', 184500.00, 184500.00, 0, 0, 'ACTIVE', now);
  insertAcc.run('acc_dk_gbp', 'tenant_promoney', 'usr_customer_1', null, 'PM-10048294', 'GB29PMNY60161331926819', 'PMNYGB2LXXX', 'MULTI_CURRENCY', 'GBP London Wallet', 'GBP', 4310.75, 4310.75, 0, 0, 'ACTIVE', now);
  insertAcc.run('acc_dk_sav', 'tenant_promoney', 'usr_customer_1', null, 'PM-10048295', 'DE12500105175407324999', 'PMNYDEFFXXX', 'SAVINGS', 'Vault EUR Savings', 'EUR', 15000.00, 15000.00, 0, 0, 'ACTIVE', now);

  // Elena Vance (Isolated Customer #2 - used to prove strict data isolation)
  insertAcc.run('acc_ev_eur', 'tenant_promoney', 'usr_customer_2', null, 'PM-20099101', 'GB82PMNY60161331999101', 'PMNYGB2LXXX', 'PERSONAL', 'Elena EUR Account', 'EUR', 8200.00, 8200.00, 0, 0, 'ACTIVE', now);

  // Business Account (Atelier Nova)
  insertAcc.run('acc_biz_eur', 'tenant_promoney', 'usr_business_1', 'biz_atelier', 'PM-30077210', 'DE44500105175407399210', 'PMNYDEFFXXX', 'BUSINESS', 'Atelier Nova Operating EUR', 'EUR', 68400.00, 68400.00, 0, 0, 'ACTIVE', now);
  insertAcc.run('acc_biz_usd', 'tenant_promoney', 'usr_business_1', 'biz_atelier', 'PM-30077211', 'US88PMNY00030077211001', 'PMNYUS33XXX', 'CORPORATE', 'Atelier Nova USD Treasury', 'USD', 31200.00, 31200.00, 0, 0, 'ACTIVE', now);

  // Merchant Settlement Account (Velvet Roastery)
  insertAcc.run('acc_mer_try', 'tenant_promoney', 'usr_merchant_1', null, 'PM-40088120', 'TR770006100519786457888120', 'PMNYTRISXXX', 'BUSINESS', 'Velvet Roastery Merchant TRY', 'TRY', 92450.00, 92450.00, 0, 0, 'ACTIVE', now);
  insertAcc.run('acc_mer_eur', 'tenant_promoney', 'usr_merchant_1', null, 'PM-40088121', 'DE91500105175407388121', 'PMNYDEFFXXX', 'BUSINESS', 'Velvet Roastery Settlement EUR', 'EUR', 6420.00, 6420.00, 0, 0, 'ACTIVE', now);

  // Demo Personal (Emre Demir #100010)
  insertAcc.run('acc_demo_p_try_6000', 'tenant_promoney', 'usr_demo_personal', null, 'PM-10001001', 'TR100006100519786457100010', 'PMNYTRISXXX', 'PERSONAL', '6.000 TL Günlük Hesap', 'TRY', 6000.00, 6000.00, 0, 0, 'ACTIVE', now);
  insertAcc.run('acc_demo_p_eur', 'tenant_promoney', 'usr_demo_personal', null, 'PM-10001002', 'DE10500105175407310010', 'PMNYDEFFXXX', 'MULTI_CURRENCY', 'Demo EUR Cüzdan', 'EUR', 4500.00, 4500.00, 0, 0, 'ACTIVE', now);

  // Demo Business (Anadolu Teknoloji A.Ş. #200010)
  insertAcc.run('acc_demo_b_try', 'tenant_promoney', 'usr_demo_business', 'biz_demo_anadolu', 'PM-20001001', 'TR200006100519786457200010', 'PMNYTRISXXX', 'BUSINESS', 'Anadolu Teknoloji TRY Ana Hesap', 'TRY', 145000.00, 145000.00, 0, 0, 'ACTIVE', now);
  insertAcc.run('acc_demo_b_eur', 'tenant_promoney', 'usr_demo_business', 'biz_demo_anadolu', 'PM-20001002', 'DE20500105175407320010', 'PMNYDEFFXXX', 'CORPORATE', 'Anadolu Teknoloji EUR Treasury', 'EUR', 22000.00, 22000.00, 0, 0, 'ACTIVE', now);

  // Demo Merchant (Marmara Gurme Market #300010)
  insertAcc.run('acc_demo_m_try', 'tenant_promoney', 'usr_demo_merchant', null, 'PM-30001001', 'TR300006100519786457300010', 'PMNYTRISXXX', 'BUSINESS', 'Marmara Gurme POS Hakediş TRY', 'TRY', 48500.00, 48500.00, 0, 0, 'ACTIVE', now);

  // 5. Initial Balanced Transactions & Immutable Double-Entry Ledger
  const insertTx = db.prepare(
    `INSERT INTO transactions (id, idempotency_key, tenant_id, user_id, from_account_id, to_account_id, counterparty_name, counterparty_iban, type, category, amount, fee, currency, direction, status, reference, source, authorization_code, is_sandbox, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  );
  const insertLedger = db.prepare(
    `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const t1 = new Date(Date.now() - 86400000 * 3).toISOString();
  const t2 = new Date(Date.now() - 86400000 * 2).toISOString();
  const t3 = new Date(Date.now() - 86400000 * 1).toISOString();
  const t4 = new Date(Date.now() - 3600000 * 5).toISOString();

  insertTx.run('tx_seed_1', 'idem_seed_1', 'tenant_promoney', 'usr_customer_1', null, 'acc_dk_eur', 'Sandbox Clearing Deposit', 'DE00TESTCLEARING001', 'DEPOSIT', 'Funding', 26500.00, 0, 'EUR', 'IN', 'COMPLETED', 'PM-DEP-9012', 'SANDBOX_BANK_RAIL', 'AUTH-9012', t1);
  insertLedger.run('ldg_1a', 'tx_seed_1', null, 'pool_A', 'DEBIT', 26500.00, 'EUR', 'Safeguarded Pool A funding intake', t1);
  insertLedger.run('ldg_1b', 'tx_seed_1', 'acc_dk_eur', null, 'CREDIT', 26500.00, 'EUR', 'Credit Main EUR Account', t1);

  insertTx.run('tx_seed_2', 'idem_seed_2', 'tenant_promoney', 'usr_customer_1', 'acc_dk_eur', null, 'Lufthansa Airlines', 'DE22500105170000991122', 'CARD_PAYMENT', 'Travel', 485.60, 0, 'EUR', 'OUT', 'COMPLETED', 'PM-CRD-4418', 'VISA_SANDBOX_PROGRAM', 'AUTH-4418', t2);
  insertLedger.run('ldg_2a', 'tx_seed_2', 'acc_dk_eur', null, 'DEBIT', 485.60, 'EUR', 'Card spend Lufthansa', t2);
  insertLedger.run('ldg_2b', 'tx_seed_2', null, 'pool_C', 'CREDIT', 485.60, 'EUR', 'Card Settlement Pool C', t2);

  insertTx.run('tx_seed_3', 'idem_seed_3', 'tenant_promoney', 'usr_customer_1', 'acc_dk_eur', null, 'Apple Store Zurich', 'CH9300762011623852957', 'CARD_PAYMENT', 'Electronics', 914.00, 0, 'EUR', 'OUT', 'COMPLETED', 'PM-CRD-7721', 'MASTERCARD_SANDBOX_PROGRAM', 'AUTH-7721', t3);
  insertLedger.run('ldg_3a', 'tx_seed_3', 'acc_dk_eur', null, 'DEBIT', 914.00, 'EUR', 'Card spend Apple Store', t3);
  insertLedger.run('ldg_3b', 'tx_seed_3', null, 'pool_C', 'CREDIT', 914.00, 'EUR', 'Card Settlement Pool C', t3);

  insertTx.run('tx_seed_4', 'idem_seed_4', 'tenant_promoney', 'usr_customer_1', 'acc_dk_eur', null, 'Hotel Bosphorus Pre-Auth', 'TR100006100519786457800001', 'POS_PAYMENT', 'Hospitality', 250.00, 0, 'EUR', 'OUT', 'PENDING', 'PM-POS-5520', 'POS_SANDBOX', 'AUTH-5520', t4);
  insertLedger.run('ldg_4a', 'tx_seed_4', 'acc_dk_eur', null, 'DEBIT', 250.00, 'EUR', 'Pending hotel pre-authorization', t4);
  insertLedger.run('ldg_4b', 'tx_seed_4', null, 'pool_D', 'CREDIT', 250.00, 'EUR', 'Payment Settlement Pool D hold', t4);

  // Business & Merchant sample transactions
  insertTx.run('tx_seed_5', 'idem_seed_5', 'tenant_promoney', 'usr_business_1', null, 'acc_biz_eur', 'Nordic Design Studio GmbH', 'DE11370400440532013000', 'SEPA_INSTANT', 'Client Invoice', 18400.00, 0, 'EUR', 'IN', 'COMPLETED', 'INV-2026-041', 'SEPA_SANDBOX', 'AUTH-8821', t2);
  insertLedger.run('ldg_5a', 'tx_seed_5', null, 'pool_A', 'DEBIT', 18400.00, 'EUR', 'SEPA Instant incoming settlement', t2);
  insertLedger.run('ldg_5b', 'tx_seed_5', 'acc_biz_eur', null, 'CREDIT', 18400.00, 'EUR', 'Atelier Nova Operating EUR credit', t2);

  insertTx.run('tx_seed_6', 'idem_seed_6', 'tenant_promoney', 'usr_merchant_1', null, 'acc_mer_try', 'POS Terminal #VR-01 Batch', 'TR00POSBATCH0001', 'POS_PAYMENT', 'Merchant Sales', 14250.00, 213.75, 'TRY', 'IN', 'COMPLETED', 'POS-BATCH-119', 'POS_ACQUIRER_SANDBOX', 'AUTH-6632', t3);
  insertLedger.run('ldg_6a', 'tx_seed_6', null, 'pool_D', 'DEBIT', 14250.00, 'TRY', 'POS batch clearing', t3);
  insertLedger.run('ldg_6b', 'tx_seed_6', 'acc_mer_try', null, 'CREDIT', 14250.00, 'TRY', 'Merchant TRY settlement', t3);

  insertTx.run('tx_seed_7', 'idem_seed_7', 'tenant_promoney', 'usr_customer_1', null, 'acc_dk_try_6000', 'PRO MONEY TRY Bütçe Yüklemesi', 'TR00TESTCLEARING002', 'DEPOSIT', 'Funding', 6000.00, 0, 'TRY', 'IN', 'COMPLETED', 'PM-TRY-6000', 'SANDBOX_BANK_RAIL', 'AUTH-6000', t1);
  insertLedger.run('ldg_7a', 'tx_seed_7', null, 'pool_A', 'DEBIT', 6000.00, 'TRY', 'Safeguarded Pool A TRY intake', t1);
  insertLedger.run('ldg_7b', 'tx_seed_7', 'acc_dk_try_6000', null, 'CREDIT', 6000.00, 'TRY', 'Credit 6.000 TL Günlük Hesap', t1);

  insertTx.run('tx_seed_8', 'idem_seed_8', 'tenant_promoney', 'usr_demo_personal', null, 'acc_demo_p_try_6000', 'PRO MONEY Demo Açılış Bakiyesi', 'TR00DEMO6000', 'DEPOSIT', 'Funding', 6000.00, 0, 'TRY', 'IN', 'COMPLETED', 'PM-DEMO-6000', 'SANDBOX_BANK_RAIL', 'AUTH-1010', t1);
  insertLedger.run('ldg_8a', 'tx_seed_8', null, 'pool_A', 'DEBIT', 6000.00, 'TRY', 'Demo Personal Pool A TRY intake', t1);
  insertLedger.run('ldg_8b', 'tx_seed_8', 'acc_demo_p_try_6000', null, 'CREDIT', 6000.00, 'TRY', 'Credit Demo 6.000 TL Günlük Hesap', t1);

  insertTx.run('tx_seed_9', 'idem_seed_9', 'tenant_promoney', 'usr_demo_business', null, 'acc_demo_b_try', 'Anadolu Teknoloji Kurumsal Fonlama', 'TR00DEMOBIZ', 'DEPOSIT', 'Treasury', 145000.00, 0, 'TRY', 'IN', 'COMPLETED', 'PM-BIZ-200010', 'SANDBOX_BANK_RAIL', 'AUTH-2010', t2);
  insertLedger.run('ldg_9a', 'tx_seed_9', null, 'pool_A', 'DEBIT', 145000.00, 'TRY', 'Demo Business Pool A TRY intake', t2);
  insertLedger.run('ldg_9b', 'tx_seed_9', 'acc_demo_b_try', null, 'CREDIT', 145000.00, 'TRY', 'Credit Anadolu Teknoloji TRY', t2);

  // 6. Cards (Visa, Mastercard, TROY — Masked PAN only, PCI DSS compliant)
  const pinHash = hashPassword('2580');
  const insertCard = db.prepare(
    `INSERT INTO cards (id, tenant_id, user_id, account_id, holder_name, last4, expiry, scheme, product_type, design_variant, status, online_enabled, contactless_enabled, atm_enabled, daily_limit, monthly_limit, spent_today, spent_month, delivery_status, pin_hash, is_sandbox, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  );
  insertCard.run('crd_1', 'tenant_promoney', 'usr_customer_1', 'acc_dk_eur', 'DENIZ KAYA', '4829', '09/29', 'VISA', 'PREMIUM', 'OBSIDIAN', 'ACTIVE', 1, 1, 1, 5000, 25000, 485.60, 2410.00, 'Delivered & Activated', pinHash, now);
  insertCard.run('crd_2', 'tenant_promoney', 'usr_customer_1', 'acc_dk_usd', 'DENIZ KAYA', '9104', '11/28', 'MASTERCARD', 'VIRTUAL', 'ROSE_METAL', 'ACTIVE', 1, 0, 0, 3000, 15000, 0, 914.00, 'Instant Virtual Active', pinHash, now);
  insertCard.run('crd_3', 'tenant_promoney', 'usr_customer_1', 'acc_dk_try', 'DENIZ KAYA', '3371', '04/30', 'TROY', 'DEBIT', 'CHAMPAGNE_GOLD', 'ACTIVE', 1, 1, 1, 50000, 250000, 0, 12400.00, 'Delivered & Activated', pinHash, now);
  insertCard.run('crd_4', 'tenant_promoney', 'usr_business_1', 'acc_biz_eur', 'ATELIER NOVA GMBH', '7740', '07/29', 'MASTERCARD', 'CORPORATE', 'CORPORATE_SLATE', 'ACTIVE', 1, 1, 1, 15000, 80000, 0, 4200.00, 'Delivered & Activated', pinHash, now);
  insertCard.run('crd_5', 'tenant_promoney', 'usr_demo_personal', 'acc_demo_p_try_6000', 'EMRE DEMIR', '6010', '08/30', 'TROY', 'DEBIT', 'CHAMPAGNE_GOLD', 'ACTIVE', 1, 1, 1, 6000, 30000, 0, 0, 'Delivered & Activated', pinHash, now);
  insertCard.run('crd_6', 'tenant_promoney', 'usr_demo_business', 'acc_demo_b_try', 'ANADOLU TEKNOLOJI', '2010', '10/29', 'VISA', 'CORPORATE', 'CORPORATE_SLATE', 'ACTIVE', 1, 1, 1, 50000, 250000, 0, 0, 'Delivered & Activated', pinHash, now);

  // 7. Beneficiaries
  const insertBen = db.prepare(
    `INSERT INTO beneficiaries (id, user_id, name, iban, bic, bank_name, currency, country, is_trusted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertBen.run('ben_1', 'usr_customer_1', 'Mert Aydin', 'TR640006200048200006298123', 'TGBATRISXXX', 'Garanti BBVA (Sandbox Ref)', 'TRY', 'TR', 1);
  insertBen.run('ben_2', 'usr_customer_1', 'Clara Lindqvist', 'DE75512108001245126199', 'SOLADEST600', 'Deutsche Bank AG (Sandbox Ref)', 'EUR', 'DE', 1);
  insertBen.run('ben_3', 'usr_customer_1', 'Atelier Nova GmbH', 'DE44500105175407399210', 'PMNYDEFFXXX', 'PRO MONEY Business', 'EUR', 'DE', 1);

  // 8. Scheduled Transfers
  db.prepare(
    `INSERT INTO scheduled_transfers (id, user_id, from_account_id, beneficiary_name, beneficiary_iban, amount, currency, frequency, next_run_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('sch_1', 'usr_customer_1', 'acc_dk_eur', 'Clara Lindqvist', 'DE75512108001245126199', 650.00, 'EUR', 'MONTHLY', '2026-12-01', 'ACTIVE');

  // 9. ATMs
  const insertAtm = db.prepare(
    `INSERT INTO atms (id, code, location, city, country, status, daily_limit, fee_percent, supported_schemes_json, last_diagnostic)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertAtm.run('atm_1', 'PM-IST-001', 'Nisantasi Abdi Ipekci Cad. No:42', 'Istanbul', 'TR', 'OPERATIONAL_SANDBOX', 15000, 0, JSON.stringify(['VISA', 'MASTERCARD', 'TROY']), now);
  insertAtm.run('atm_2', 'PM-LDN-004', 'Canary Wharf Jubilee Place', 'London', 'GB', 'OPERATIONAL_SANDBOX', 2000, 0, JSON.stringify(['VISA', 'MASTERCARD']), now);
  insertAtm.run('atm_3', 'PM-FRA-002', 'Taunusanlage 12 Financial Hub', 'Frankfurt', 'DE', 'LOW_CASH', 3000, 0.5, JSON.stringify(['VISA', 'MASTERCARD']), now);

  // 10. FX Reference Rates (Sandbox Feed)
  const insertFx = db.prepare(
    `INSERT INTO fx_rates (pair, base, quote, bid, ask, mid, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const fxPairs: Array<[string, string, string, number]> = [
    ['EUR/USD', 'EUR', 'USD', 1.0842],
    ['EUR/TRY', 'EUR', 'TRY', 37.4500],
    ['EUR/GBP', 'EUR', 'GBP', 0.8540],
    ['EUR/CHF', 'EUR', 'CHF', 0.9415],
    ['EUR/SAR', 'EUR', 'SAR', 4.0658],
    ['EUR/AED', 'EUR', 'AED', 3.9812],
    ['USD/TRY', 'USD', 'TRY', 34.5416],
    ['USD/GBP', 'USD', 'GBP', 0.7877],
    ['GBP/TRY', 'GBP', 'TRY', 43.8520]
  ];
  for (const [pair, base, quote, mid] of fxPairs) {
    const spread = mid * 0.0015;
    insertFx.run(pair, base, quote, Number((mid - spread).toFixed(4)), Number((mid + spread).toFixed(4)), mid, 'SANDBOX_REFERENCE_FEED (Requires Live Liquidity Provider)', now);
  }

  // 11. Savings Products & Initial Position
  const insertSavProd = db.prepare(
    `INSERT INTO savings_products (id, name, type, currency, apy_percent, term_days, min_amount, regulatory_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertSavProd.run('sav_flex_eur', 'PRO MONEY Flexible EUR Vault', 'FLEXIBLE', 'EUR', 3.15, 0, 100, 'Sandbox Yield Simulation — Requires Licensed Partner Bank for Live Interest');
  insertSavProd.run('sav_fixed_usd', 'PRO MONEY 90-Day Fixed USD', 'FIXED_TERM', 'USD', 4.40, 90, 1000, 'Sandbox Yield Simulation — Not Insured Until Partner Bank Activation');
  insertSavProd.run('sav_flex_try', 'PRO MONEY Flexible TRY Vault', 'FLEXIBLE', 'TRY', 32.00, 0, 5000, 'Sandbox Yield Simulation — Subject to Partner Bank Terms');

  db.prepare(
    `INSERT INTO savings_positions (id, user_id, account_id, product_id, product_name, currency, principal, accrued_interest, apy_percent, maturity_date, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('pos_sav_1', 'usr_customer_1', 'acc_dk_sav', 'sav_flex_eur', 'PRO MONEY Flexible EUR Vault', 'EUR', 15000.00, 118.42, 3.15, null, 'ACTIVE', now);

  // 12. Sample Loan Application
  db.prepare(
    `INSERT INTO loans (id, user_id, account_id, product_type, principal_amount, outstanding_balance, apr_percent, term_months, monthly_installment, currency, status, next_due_date, funding_source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('loan_1', 'usr_customer_1', 'acc_dk_eur', 'PERSONAL_LOAN', 5000.00, 3820.00, 8.90, 12, 436.95, 'EUR', 'APPROVED_SANDBOX', '2026-12-15', 'Pool E — Segregated Credit Facility (Sandbox)', now);

  // 13. Business Entity, Members & Invoices
  db.prepare(
    `INSERT INTO businesses (id, owner_user_id, company_name, registration_number, tax_id, country, kyb_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('biz_atelier', 'usr_business_1', 'Atelier Nova GmbH', 'HRB 219044', 'DE319847221', 'DE', 'VERIFIED', now);
  db.prepare(
    `INSERT INTO businesses (id, owner_user_id, company_name, registration_number, tax_id, country, kyb_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('biz_demo_anadolu', 'usr_demo_business', 'Anadolu Teknoloji A.Ş.', 'IST-904821', 'TR8841209512', 'TR', 'VERIFIED', now);

  const insertMember = db.prepare(
    `INSERT INTO business_members (id, business_id, user_id, full_name, email, role_title, permissions_json, approval_limit, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertMember.run('bm_1', 'biz_atelier', 'usr_business_1', 'Kerem Arslan', 'finance@atelier-nova.test', 'Managing Director', JSON.stringify(['VIEW_ACCOUNTS', 'INITIATE_PAYMENT', 'APPROVE_PAYMENT', 'MANAGE_CARDS', 'MANAGE_TEAM']), 100000, 'ACTIVE');
  insertMember.run('bm_2', 'biz_atelier', 'usr_biz_emp_1', 'Lukas Meyer', 'lukas@atelier-nova.test', 'Finance Controller', JSON.stringify(['VIEW_ACCOUNTS', 'INITIATE_PAYMENT', 'ISSUE_INVOICES']), 10000, 'ACTIVE');
  insertMember.run('bm_3', 'biz_demo_anadolu', 'usr_demo_business', 'Zeynep Aksoy', 'demo.sirket@promoney.test', 'Finans Direktörü', JSON.stringify(['VIEW_ACCOUNTS', 'INITIATE_PAYMENT', 'APPROVE_PAYMENT', 'MANAGE_CARDS', 'MANAGE_TEAM']), 250000, 'ACTIVE');

  db.prepare(
    `INSERT INTO business_invoices (id, business_id, invoice_number, client_name, client_email, amount, currency, due_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('inv_1', 'biz_atelier', 'INV-2026-042', 'Kopenhagen Studio ApS', 'ap@kopenhagenstudio.dk', 9450.00, 'EUR', '2026-12-10', 'SENT', now);
  db.prepare(
    `INSERT INTO business_invoices (id, business_id, invoice_number, client_name, client_email, amount, currency, due_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('inv_2', 'biz_demo_anadolu', 'FTR-2026-108', 'Boğaziçi Yazılım Ltd.', 'muhasebe@bogazici.test', 28500.00, 'TRY', '2026-12-15', 'SENT', now);

  // 14. Merchant, POS Terminals & Payment Links
  db.prepare(
    `INSERT INTO merchants (id, user_id, business_name, mcc, country, settlement_currency, verification_status, acquirer_status, volume_30d)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('mer_velvet', 'usr_merchant_1', 'Velvet Roastery & Cafe', '5814', 'TR', 'TRY', 'VERIFIED', 'SANDBOX_ACQUIRER (Requires Live Acquiring Contract)', 284500.00);
  db.prepare(
    `INSERT INTO merchants (id, user_id, business_name, mcc, country, settlement_currency, verification_status, acquirer_status, volume_30d)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('mer_demo_marmara', 'usr_demo_merchant', 'Marmara Gurme Market', '5411', 'TR', 'TRY', 'VERIFIED', 'SANDBOX_ACQUIRER (Requires Live Acquiring Contract)', 94200.00);

  const insertTerminal = db.prepare(
    `INSERT INTO pos_terminals (id, merchant_id, serial_number, model, location_name, status, supports_contactless, supports_qr, supports_offline_rules, last_heartbeat)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertTerminal.run('pos_1', 'mer_velvet', 'PM-POS-882104', 'PRO MONEY Terminal X2 (EMV/NFC)', 'Karakoy Flagship Counter 1', 'ONLINE_SANDBOX', 1, 1, 1, now);
  insertTerminal.run('pos_2', 'mer_velvet', 'PM-POS-882105', 'PRO MONEY Pocket Tap M1', 'Bebek Pop-Up Kiosk', 'ONLINE_SANDBOX', 1, 1, 0, now);
  insertTerminal.run('pos_3', 'mer_demo_marmara', 'PM-POS-300010', 'PRO MONEY Terminal X2 (EMV/NFC)', 'Çankaya Merkez Kasa 1', 'ONLINE_SANDBOX', 1, 1, 1, now);

  db.prepare(
    `INSERT INTO payment_links (id, merchant_id, title, amount, currency, status, requires_3ds, checkout_code, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('pl_1', 'mer_velvet', 'Specialty Coffee Roastery Wholesale Box', 420.00, 'EUR', 'ACTIVE', 1, 'PM-CHK-9941', now);
  db.prepare(
    `INSERT INTO payment_links (id, merchant_id, title, amount, currency, status, requires_3ds, checkout_code, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('pl_2', 'mer_demo_marmara', 'Gurme Şarküteri Kurumsal Sepet', 2450.00, 'TRY', 'ACTIVE', 1, 'PM-CHK-3010', now);

  // 15. Membership Plans (Standard -> Corporate)
  const insertPlan = db.prepare(
    `INSERT INTO membership_plans (tier, monthly_price_eur, daily_transfer_limit_eur, fx_monthly_free_allowance_eur, fx_markup_bps, card_tier_label, support_sla, features_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertPlan.run('Standard', 0, 5000, 1000, 50, 'Virtual & Standard Debit', 'Standard Ticket Queue', JSON.stringify(['Multi-currency IBAN', 'Instant internal transfers', 'Virtual Visa/Mastercard/TROY']));
  insertPlan.run('Silver', 4.99, 15000, 3000, 35, 'Rose-Pink Matte Debit', 'Priority Chat', JSON.stringify(['3,000 EUR FX fee-free/mo', '2 physical cards', 'Spending insights & AI Assistant']));
  insertPlan.run('Gold', 9.99, 30000, 10000, 20, 'Champagne Gold Card', '24/7 Priority Support', JSON.stringify(['10,000 EUR FX fee-free/mo', 'Lounge discount access (Provider pending)', 'Higher ATM limits']));
  insertPlan.run('Platinum', 19.99, 75000, 50000, 10, 'Obsidian Brushed Metal', 'Dedicated Relationship Desk', JSON.stringify(['50,000 EUR FX fee-free/mo', '0.10% FX interbank markup', 'Priority SEPA & SWIFT routing']));
  insertPlan.run('Black', 49.99, 250000, 999999, 0, 'PRO MONEY Black Obsidian Metal', 'Concierge & Dedicated Officer', JSON.stringify(['Unlimited fee-free FX', 'Custom metal card engraving', 'Priority compliance & treasury']));
  insertPlan.run('Business', 29.00, 150000, 25000, 15, 'Corporate Slate Cards', 'Business SLA', JSON.stringify(['Multi-user team roles', 'Approval workflows', 'Invoicing & Bulk payouts']));
  insertPlan.run('Corporate', 149.00, 1000000, 250000, 5, 'Unlimited Corporate Cards', 'Dedicated Treasury Desk', JSON.stringify(['API & Webhook access', 'White-label readiness', 'Custom dual-approval rules']));

  // 16. KYC / KYB & AML / Fraud Cases
  db.prepare(
    `INSERT INTO kyc_kyb_records (id, user_id, subject_name, record_type, document_type, document_last4, pep_check, sanctions_check, risk_score, status, reviewed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('kyc_1', 'usr_customer_1', 'Deniz Kaya', 'KYC', 'National Passport', '9481', 'CLEAR', 'CLEAR', 12, 'VERIFIED', 'usr_compliance_1', now);
  db.prepare(
    `INSERT INTO kyc_kyb_records (id, user_id, subject_name, record_type, document_type, document_last4, pep_check, sanctions_check, risk_score, status, reviewed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('kyb_1', 'usr_business_1', 'Atelier Nova GmbH', 'KYB', 'Commercial Register Extract', '9044', 'CLEAR', 'CLEAR', 18, 'VERIFIED', 'usr_compliance_1', now);

  db.prepare(
    `INSERT INTO aml_fraud_cases (id, user_id, transaction_id, case_type, severity, risk_score, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('aml_1', 'usr_customer_1', 'tx_seed_4', 'FRAUD', 'MEDIUM', 54, 'Cross-border hospitality pre-authorization check (Sandbox velocity monitor)', 'OPEN', now);

  // 16b. 4-Pillar Identity, Passport, Address & Phone Verifications
  const insertVerif = db.prepare(
    `INSERT INTO identity_verifications (
       id, user_id, verification_type, document_number, issuing_country, expiry_date,
       address_full, city, postal_code, phone_number, proof_reference,
       status, rejection_reason, verified_by, verified_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Deniz Kaya - all 4 verified
  insertVerif.run('ver_dk_id', 'usr_customer_1', 'IDENTITY_CARD', '24681357902', 'TR', '2032-05-14', null, null, null, null, 'TC-KIMLIK-NFC-OK', 'VERIFIED', null, 'usr_compliance_1', now, now);
  insertVerif.run('ver_dk_pas', 'usr_customer_1', 'PASSPORT', 'U24908142', 'TR', '2031-09-20', null, null, null, null, 'PASSPORT-MRZ-OK', 'VERIFIED', null, 'usr_compliance_1', now, now);
  insertVerif.run('ver_dk_adr', 'usr_customer_1', 'ADDRESS', null, 'TR', null, 'Abdi İpekçi Cad. No:42 D:8, Nişantaşı', 'İstanbul', '34367', null, 'EDEVLET-IKAMETGAH-9041', 'VERIFIED', null, 'usr_compliance_1', now, now);
  insertVerif.run('ver_dk_phn', 'usr_customer_1', 'PHONE', null, 'TR', null, null, null, null, '+90 532 555 0192', 'SMS-OTP-VERIFIED', 'VERIFIED', null, 'usr_compliance_1', now, now);

  // Demo Personal (Emre Demir #100010) - all 4 verified
  insertVerif.run('ver_dp_id', 'usr_demo_personal', 'IDENTITY_CARD', '19283746502', 'TR', '2033-01-12', null, null, null, null, 'TC-KIMLIK-100010', 'VERIFIED', null, 'usr_demo_admin', now, now);
  insertVerif.run('ver_dp_pas', 'usr_demo_personal', 'PASSPORT', 'U77102945', 'TR', '2032-04-08', null, null, null, null, 'PASSPORT-100010', 'VERIFIED', null, 'usr_demo_admin', now, now);
  insertVerif.run('ver_dp_adr', 'usr_demo_personal', 'ADDRESS', null, 'TR', null, 'Bağdat Caddesi No:214 D:5, Kadıköy', 'İstanbul', '34728', null, 'IKAMETGAH-100010', 'VERIFIED', null, 'usr_demo_admin', now, now);
  insertVerif.run('ver_dp_phn', 'usr_demo_personal', 'PHONE', null, 'TR', null, null, null, null, '+90 532 100 0010', 'SMS-OTP-100010', 'VERIFIED', null, 'usr_demo_admin', now, now);

  // Demo Merchant (Canberk Yılmaz #300010) - Passport awaiting review
  insertVerif.run('ver_dm_id', 'usr_demo_merchant', 'IDENTITY_CARD', '56473829108', 'TR', '2031-11-03', null, null, null, null, 'TC-KIMLIK-300010', 'VERIFIED', null, 'usr_demo_admin', now, now);
  insertVerif.run('ver_dm_pas', 'usr_demo_merchant', 'PASSPORT', 'U31209874', 'TR', '2030-07-19', null, null, null, null, 'PASSPORT-SCAN-300010', 'PENDING', null, null, null, now);
  insertVerif.run('ver_dm_adr', 'usr_demo_merchant', 'ADDRESS', null, 'TR', null, 'Atatürk Bulvarı No:94, Çankaya', 'Ankara', '06420', null, 'FATURA-300010', 'VERIFIED', null, 'usr_demo_admin', now, now);
  insertVerif.run('ver_dm_phn', 'usr_demo_merchant', 'PHONE', null, 'TR', null, null, null, null, '+90 532 300 0010', 'SMS-OTP-300010', 'VERIFIED', null, 'usr_demo_admin', now, now);

  // Pending applicants awaiting verification review
  insertVerif.run('ver_p1_id', 'usr_pending_1', 'IDENTITY_CARD', '65748392014', 'TR', '2034-03-10', null, null, null, null, 'KIMLIK-BURAK-01', 'PENDING', null, null, null, now);
  insertVerif.run('ver_p1_adr', 'usr_pending_1', 'ADDRESS', null, 'TR', null, 'Cumhuriyet Mah. İstiklal Sk. No:12', 'İzmir', '35220', null, 'IKAMETGAH-BURAK', 'PENDING', null, null, null, now);
  insertVerif.run('ver_dpend_id', 'usr_demo_pending', 'IDENTITY_CARD', '74839201654', 'TR', '2033-08-22', null, null, null, null, 'KIMLIK-ELIF-100100', 'PENDING', null, null, null, now);
  insertVerif.run('ver_dpend_adr', 'usr_demo_pending', 'ADDRESS', null, 'TR', null, 'Tunalı Hilmi Cad. No:64 D:3', 'Ankara', '06680', null, 'IKAMETGAH-ELIF', 'PENDING', null, null, null, now);

  // 17. Support Ticket
  db.prepare(
    `INSERT INTO support_tickets (id, user_id, subject, category, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('tkt_1', 'usr_customer_1', 'SEPA Instant settlement timing inquiry', 'Transfers', 'NORMAL', 'OPEN', now, now);
  db.prepare(
    `INSERT INTO ticket_messages (id, ticket_id, sender_id, sender_name, sender_role, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('tmsg_1', 'tkt_1', 'usr_customer_1', 'Deniz Kaya', 'INDIVIDUAL_CUSTOMER', 'Hello PRO MONEY support, can you confirm whether SEPA Instant is operating in Sandbox or live rail?', now);

  // 18. Notifications
  db.prepare(
    `INSERT INTO notifications (id, user_id, title, body, severity, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run('notif_1', 'usr_customer_1', 'Welcome to PRO MONEY Sandbox', 'All balances and IBANs shown are TEST/SANDBOX records backed by our central double-entry ledger.', 'INFO', now);
  db.prepare(
    `INSERT INTO notifications (id, user_id, title, body, severity, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run('notif_2', 'usr_admin_1', 'Compliance Queue Active', '1 transaction alert awaits review in AML & Fraud Monitoring.', 'WARNING', now);
  db.prepare(
    `INSERT INTO notifications (id, user_id, title, body, severity, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run('notif_3', 'usr_demo_personal', 'PRO MONEY Demo Hesabınız Hazır', '6.000 TL Günlük Hesabınız, TROY kartınız ve 4/4 kimlik doğrulamalarınız aktif.', 'SUCCESS', now);

  // 19. Provider Integrations Registry (Honest Readiness Statuses)
  const insertProvider = db.prepare(
    `INSERT INTO providers (id, name, category, environment, status, details, last_checked) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertProvider.run('prv_sepa', 'European SEPA / SWIFT Clearing Rail', 'BANKING_RAIL', 'SANDBOX', 'Requires Provider', 'Requires authorized banking/EMI partner & SWIFT BIC sponsorship for live MT103/ISO 20022 clearing.', now);
  insertProvider.run('prv_visa', 'Visa Direct & Issuing Processor', 'CARD_ISSUER', 'SANDBOX', 'Requires Certification', 'Requires BIN Sponsor agreement, PCI DSS AoC, and Visa program approval.', now);
  insertProvider.run('prv_mc', 'Mastercard Issuing & MDES', 'CARD_ISSUER', 'SANDBOX', 'Requires Certification', 'Requires Mastercard Principal/Affiliate license or BIN sponsor integration.', now);
  insertProvider.run('prv_troy', 'BKM TROY Domestic Card Network', 'CARD_ISSUER', 'SANDBOX', 'Requires Contract', 'Requires TROY issuer licensing and BKM switch certification.', now);
  insertProvider.run('prv_pos', 'Acquiring & EMV POS Gateway', 'ACQUIRING_POS', 'SANDBOX', 'Requires Certification', 'Requires certified Level 1/2/3 EMV hardware terminals and acquiring processor contract.', now);
  insertProvider.run('prv_fx', 'Institutional FX Liquidity Feed', 'FX_FEED', 'SANDBOX', 'Sandbox Only', 'Using internal sandbox reference rates; connect licensed FX liquidity provider for live settlement.', now);
  insertProvider.run('prv_kyc', 'Identity, PEP & Sanctions Screening API', 'KYC_AML', 'SANDBOX', 'Requires Provider', 'Connect Onfido/Sumsub/ComplyAdvantage API key for live document & AML screening.', now);
  insertProvider.run('prv_ob', 'PSD2 / Open Banking AIS & PIS Hub', 'OPEN_BANKING', 'SANDBOX', 'Requires License', 'Requires AISP/PISP regulatory authorization and QWAC/QSEAL eIDAS certificates.', now);

  // 20. API Keys & Webhooks
  db.prepare(
    `INSERT INTO api_keys (id, user_id, label, key_prefix, environment, scopes_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('key_1', 'usr_business_1', 'Atelier Nova ERP Sandbox Key', 'pm_sbx_8821', 'SANDBOX', JSON.stringify(['accounts:read', 'payments:write', 'webhooks:read']), 'ACTIVE', now);

  db.prepare(
    `INSERT INTO webhooks (id, user_id, url, events_json, status, last_delivery_status) VALUES (?, ?, ?, ?, ?, ?)`
  ).run('wh_1', 'usr_business_1', 'https://erp.atelier-nova.test/webhooks/promoney', JSON.stringify(['transaction.completed', 'invoice.paid']), 'ACTIVE', '200 OK (Sandbox)');

  // 21. Initial Audit Log
  db.prepare(
    `INSERT INTO audit_logs (id, actor_user_id, actor_email, actor_role, action, target_type, target_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('aud_1', 'usr_admin_1', 'admin@promoney.test', 'SUPER_ADMIN', 'SYSTEM_BOOTSTRAP', 'PLATFORM', 'PRO_MONEY', 'Initialized PRO MONEY Core Banking SQLite Ledger in Sandbox mode with Demo Users & 4-Pillar KYC.', now);
}
