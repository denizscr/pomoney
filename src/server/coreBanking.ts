import crypto from 'node:crypto';
import { db, getPrimaryClearingPool, getUserEntitlements, type UserEntitlements } from './db.ts';
import { broadcastSync } from './realtime.ts';
import { isValidLuhn } from '../shared/cardUtils.ts';
import type { CurrencyCode } from '../shared/types.ts';

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export type BooleanEntitlementKey = {
  [K in keyof UserEntitlements]: UserEntitlements[K] extends boolean ? K : never;
}[keyof UserEntitlements];

export function assertUserEntitlement(userId: string, entitlementKey: BooleanEntitlementKey, featureLabel?: string): void {
  const entitlements = getUserEntitlements(userId);
  if (!entitlements[entitlementKey]) {
    throw new ForbiddenError(`Yetki izniniz yoktur: ${featureLabel || entitlementKey} yetkisi hesabınız için kapalıdır.`);
  }
}

export function getOperationSetting(key: string):
  | {
      key: string;
      label: string;
      enabled: boolean;
      fee_fixed: number;
      fee_percent: number;
      max_amount: number;
    }
  | undefined {
  const row = db.prepare('SELECT * FROM system_operation_settings WHERE key = ?').get(key) as any;
  if (!row) return undefined;
  return {
    key: row.key,
    label: row.label,
    enabled: Boolean(row.enabled),
    fee_fixed: Number(row.fee_fixed),
    fee_percent: Number(row.fee_percent),
    max_amount: Number(row.max_amount),
  };
}

export function writeAuditLog(params: {
  actorUserId: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: string;
}) {
  db.prepare(
    `INSERT INTO audit_logs (id, actor_user_id, actor_email, actor_role, action, target_type, target_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uid('aud'),
    params.actorUserId,
    params.actorEmail,
    params.actorRole,
    params.action,
    params.targetType,
    params.targetId,
    params.metadata,
    new Date().toISOString()
  );
}

export function createNotification(userId: string, title: string, body: string, severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'ALERT' = 'INFO') {
  const id = uid('notif');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO notifications (id, user_id, title, body, severity, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(id, userId, title, body, severity, now);

  broadcastSync({
    type: 'notification:created',
    targetUserId: userId,
    data: { id, title, body, severity, createdAt: now },
  });
}

export function maybeEmitHighValueAlert(params: {
  userId: string;
  tenantId: string;
  txId: string;
  amount: number;
  currency: string;
  counterpartyName: string;
  typeLabel: string;
}) {
  const user = db
    .prepare('SELECT high_value_alerts_enabled, high_value_alert_threshold FROM users WHERE id = ?')
    .get(params.userId) as { high_value_alerts_enabled?: number; high_value_alert_threshold?: number } | undefined;

  if (!user || Number(user.high_value_alerts_enabled ?? 1) !== 1) return;
  const globalDefault = getOperationSetting('HIGH_VALUE_ALERT_DEFAULT');
  const threshold = Number(user.high_value_alert_threshold || globalDefault?.max_amount || 5000);
  if (params.amount < threshold) return;

  const title = `Yüksek Tutarlı İşlem Uyarısı (${params.amount.toFixed(2)} ${params.currency})`;
  const body = `${params.typeLabel}: ${params.counterpartyName} · Eşik (${threshold.toLocaleString('tr-TR')}) üzeri gerçek zamanlı işlem bildirimi.`;

  createNotification(params.userId, title, body, 'ALERT');
  broadcastSync({
    type: 'transaction:high_value_alert',
    targetUserId: params.userId,
    tenantId: params.tenantId,
    data: {
      txId: params.txId,
      amount: params.amount,
      currency: params.currency,
      counterpartyName: params.counterpartyName,
      typeLabel: params.typeLabel,
      threshold,
      title,
      body,
    },
  });
}

function getMembershipFeeBps(userId: string): number {
  const user = db.prepare('SELECT membership_tier FROM users WHERE id = ?').get(userId) as { membership_tier: string } | undefined;
  const plan = user
    ? (db.prepare('SELECT fx_markup_bps FROM membership_plans WHERE tier = ?').get(user.membership_tier) as { fx_markup_bps: number } | undefined)
    : undefined;
  return plan ? plan.fx_markup_bps : 50;
}

export function executeSandboxDeposit(params: {
  userId: string;
  accountId: string;
  amount: number;
  sourceLabel: string;
  idempotencyKey?: string;
}) {
  if (params.amount <= 0 || params.amount > 1000000) {
    throw new Error('Deposit amount must be between 0.01 and 1,000,000.');
  }
  const idem = params.idempotencyKey || uid('idem');
  const existing = db.prepare('SELECT * FROM transactions WHERE idempotency_key = ?').get(idem);
  if (existing) return existing;

  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(params.accountId, params.userId) as any;
  if (!account) throw new Error('Account not found or access denied.');
  if (account.status !== 'ACTIVE') throw new Error('Account is not active.');

  const txId = uid('tx');
  const now = new Date().toISOString();
  const ref = `PM-DEP-${Math.floor(100000 + Math.random() * 899999)}`;
  const authCode = `SBX-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const inflowPool = getPrimaryClearingPool('IN');

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO transactions (id, idempotency_key, tenant_id, user_id, from_account_id, to_account_id, counterparty_name, counterparty_iban, type, category, amount, fee, currency, direction, status, reference, source, authorization_code, is_sandbox, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'DEPOSIT', 'Funding', ?, 0, ?, 'IN', 'COMPLETED', ?, ?, ?, 1, ?)`
    ).run(txId, idem, account.tenant_id, params.userId, account.id, params.sourceLabel || `${inflowPool.bankName} Funding Rail`, inflowPool.iban || 'TEST-CLEARING-POOL-A', params.amount, account.currency, ref, 'SANDBOX_FUNDING', authCode, now);

    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
       VALUES (?, ?, NULL, ?, 'DEBIT', ?, ?, ?, ?)`
    ).run(uid('ldg'), txId, inflowPool.id, params.amount, account.currency, `Pool ${inflowPool.code} (${inflowPool.bankName}) intake (${ref})`, now);

    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
       VALUES (?, ?, ?, NULL, 'CREDIT', ?, ?, ?, ?)`
    ).run(uid('ldg'), txId, account.id, params.amount, account.currency, `Sandbox deposit to ${account.label}`, now);

    db.prepare(
      `UPDATE accounts SET available_balance = ROUND(available_balance + ?, 2), ledger_balance = ROUND(ledger_balance + ?, 2) WHERE id = ?`
    ).run(params.amount, params.amount, account.id);

    db.prepare(
      `UPDATE central_fund_pools SET balance = ROUND(balance + ?, 2), updated_at = ? WHERE id = ?`
    ).run(params.amount, now, inflowPool.id);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  createNotification(params.userId, 'Sandbox Deposit Credited', `+${params.amount.toFixed(2)} ${account.currency} credited to ${account.label} (TEST/SANDBOX).`, 'SUCCESS');
  maybeEmitHighValueAlert({
    userId: params.userId,
    tenantId: account.tenant_id,
    txId,
    amount: params.amount,
    currency: account.currency,
    counterpartyName: params.sourceLabel || 'Sandbox Funding Rail',
    typeLabel: 'Deposit',
  });
  broadcastSync({ type: 'account:updated', targetUserId: params.userId, tenantId: account.tenant_id, data: { accountId: account.id, txId } });
  broadcastSync({ type: 'transaction:created', targetUserId: params.userId, tenantId: account.tenant_id, data: { txId } });
  broadcastSync({ type: 'pool:updated', tenantId: account.tenant_id, data: { txId } });

  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId);
}

export function executeCardTopup(params: {
  userId: string;
  accountId: string;
  amount: number;
  cardNumber: string;
  cardHolderName: string;
  expiry: string;
  cvv: string;
  threeDsCode?: string;
  idempotencyKey?: string;
}) {
  assertUserEntitlement(params.userId, 'allowCardTopup', 'Kart ile Bakiye Yükleme');
  const op = getOperationSetting('CARD_TOPUP');
  if (op && !op.enabled) {
    throw new ForbiddenError('Yetki izniniz yoktur: Kart ile bakiye yükleme sistemi yönetim tarafından kapatılmıştır.');
  }

  const maxAmount = op ? op.max_amount : 50000;
  if (!Number.isFinite(params.amount) || params.amount <= 0 || params.amount > maxAmount) {
    throw new Error(`Yükleme tutarı 0.01 ile ${maxAmount.toLocaleString('tr-TR')} arasında olmalıdır.`);
  }

  const cleanPan = params.cardNumber.replace(/\D/g, '');
  if (!isValidLuhn(cleanPan)) {
    throw new Error('Geçersiz kart numarası (Luhn doğrulaması başarısız).');
  }
  if (!params.cardHolderName.trim()) {
    throw new Error('Kart sahibi adı zorunludur.');
  }
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(params.expiry.trim())) {
    throw new Error('Son kullanma tarihi AA/YY formatında olmalıdır.');
  }
  if (!/^\d{3,4}$/.test(params.cvv.trim())) {
    throw new Error('Geçerli 3 veya 4 haneli CVV güvenlik kodu giriniz.');
  }
  if (params.threeDsCode && !/^\d{4,6}$/.test(params.threeDsCode.trim())) {
    throw new Error('3D Secure doğrulama kodu 4-6 haneli olmalıdır.');
  }

  const cardLast4 = cleanPan.slice(-4);
  const idem = params.idempotencyKey || uid('idem');
  const existing = db.prepare('SELECT * FROM transactions WHERE idempotency_key = ?').get(idem) as any;
  if (existing) {
    return {
      transaction: existing,
      fee: Number(existing.fee || 0),
      netAmount: Number(existing.amount),
      cardLast4,
    };
  }

  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(params.accountId, params.userId) as any;
  if (!account) throw new Error('Target account not found or access denied.');
  if (account.status !== 'ACTIVE') throw new Error('Target account is not active.');

  const feeFixed = op ? Number(op.fee_fixed) : 0;
  const feePercent = op ? Number(op.fee_percent) : 0.75;
  const fee = Number((feeFixed + (params.amount * feePercent) / 100).toFixed(2));
  const netCredited = Number((params.amount - fee).toFixed(2));
  if (netCredited <= 0) {
    throw new Error('Yükleme tutarı işlem ücretini karşılamıyor.');
  }

  const txId = uid('tx');
  const now = new Date().toISOString();
  const ref = `PM-TOP-${Math.floor(100000 + Math.random() * 899999)}`;
  const authCode = `3DS-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const inflowPool = getPrimaryClearingPool('IN');

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO transactions (id, idempotency_key, tenant_id, user_id, from_account_id, to_account_id, counterparty_name, counterparty_iban, type, category, amount, fee, currency, direction, status, reference, source, authorization_code, is_sandbox, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'DEPOSIT', 'Card Top-Up', ?, ?, ?, 'IN', 'COMPLETED', ?, 'CARD_TOPUP_3DS_SANDBOX', ?, 1, ?)`
    ).run(
      txId,
      idem,
      account.tenant_id,
      params.userId,
      account.id,
      `Card Top-Up (*${cardLast4})`,
      `CARD-****-${cardLast4}`,
      netCredited,
      fee,
      account.currency,
      ref,
      authCode,
      now
    );

    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
       VALUES (?, ?, NULL, ?, 'DEBIT', ?, ?, ?, ?)`
    ).run(uid('ldg'), txId, inflowPool.id, params.amount, account.currency, `Pool ${inflowPool.code} (${inflowPool.bankName}) card top-up intake (${ref})`, now);

    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
       VALUES (?, ?, ?, NULL, 'CREDIT', ?, ?, ?, ?)`
    ).run(uid('ldg'), txId, account.id, netCredited, account.currency, `Card top-up credit (*${cardLast4})`, now);

    if (fee > 0) {
      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
         VALUES (?, ?, NULL, 'pool_G', 'CREDIT', ?, ?, ?, ?)`
      ).run(uid('ldg'), txId, fee, account.currency, `Card top-up fee (${ref})`, now);

      db.prepare(`UPDATE central_fund_pools SET balance = ROUND(balance + ?, 2), updated_at = ? WHERE id = 'pool_G'`).run(
        fee,
        now
      );
    }

    db.prepare(
      `UPDATE accounts SET available_balance = ROUND(available_balance + ?, 2), ledger_balance = ROUND(ledger_balance + ?, 2) WHERE id = ?`
    ).run(netCredited, netCredited, account.id);

    db.prepare(`UPDATE central_fund_pools SET balance = ROUND(balance + ?, 2), updated_at = ? WHERE id = ?`).run(
      netCredited,
      now,
      inflowPool.id
    );

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  createNotification(
    params.userId,
    'Kart ile Bakiye Yüklendi',
    `*${cardLast4} kartından ${netCredited.toFixed(2)} ${account.currency} (${account.label}) hesabınıza aktarıldı.`,
    'SUCCESS'
  );
  maybeEmitHighValueAlert({
    userId: params.userId,
    tenantId: account.tenant_id,
    txId,
    amount: params.amount,
    currency: account.currency,
    counterpartyName: `Card Top-Up (*${cardLast4})`,
    typeLabel: 'Card Top-Up',
  });
  broadcastSync({
    type: 'account:updated',
    targetUserId: params.userId,
    tenantId: account.tenant_id,
    data: { accountId: account.id, txId },
  });
  broadcastSync({
    type: 'transaction:created',
    targetUserId: params.userId,
    tenantId: account.tenant_id,
    data: { txId },
  });

  return {
    transaction: db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId),
    fee,
    netAmount: netCredited,
    cardLast4,
  };
}

export function executeTransfer(params: {
  userId: string;
  fromAccountId: string;
  recipientName: string;
  recipientIban: string;
  bic?: string;
  rail: 'INTERNAL_TRANSFER' | 'SEPA_TRANSFER' | 'SEPA_INSTANT' | 'SWIFT_TRANSFER' | 'WITHDRAWAL';
  amount: number;
  reference: string;
  idempotencyKey?: string;
}) {
  if (params.amount <= 0) throw new Error('Transfer amount must be positive.');
  const maint = getOperationSetting('MAINTENANCE_MODE');
  if (maint && maint.enabled) {
    throw new ForbiddenError('Sistem şu anda yönetim tarafından Bakım Moduna alınmıştır. Transferler geçici olarak durduruldu.');
  }

  if (params.rail === 'SWIFT_TRANSFER') {
    assertUserEntitlement(params.userId, 'allowSwift', 'Uluslararası SWIFT Transfer');
    const swiftOp = getOperationSetting('SWIFT_TRANSFER');
    if (swiftOp && !swiftOp.enabled) {
      throw new ForbiddenError('SWIFT transfer sistemi yönetim tarafından geçici olarak kapatılmıştır.');
    }
    if (swiftOp && swiftOp.max_amount > 0 && params.amount > swiftOp.max_amount) {
      throw new Error(`SWIFT tek işlem limiti (${swiftOp.max_amount.toLocaleString('tr-TR')}) aşıldı.`);
    }
  } else if (params.rail === 'SEPA_INSTANT') {
    const sepaOp = getOperationSetting('SEPA_INSTANT');
    if (sepaOp && !sepaOp.enabled) {
      throw new ForbiddenError('SEPA Instant transfer sistemi yönetim tarafından geçici olarak kapatılmıştır.');
    }
  }

  const idem = params.idempotencyKey || uid('idem');
  const existing = db.prepare('SELECT * FROM transactions WHERE idempotency_key = ?').get(idem);
  if (existing) return existing;

  const fromAcc = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(params.fromAccountId, params.userId) as any;
  if (!fromAcc) throw new Error('Source account not found or access denied.');
  if (fromAcc.status !== 'ACTIVE') throw new Error('Source account is frozen or closed.');

  const railOp = params.rail === 'SWIFT_TRANSFER' ? getOperationSetting('SWIFT_TRANSFER') : params.rail === 'SEPA_INSTANT' ? getOperationSetting('SEPA_INSTANT') : undefined;
  const fee =
    railOp
      ? Number((Number(railOp.fee_fixed || 0) + (params.amount * Number(railOp.fee_percent || 0)) / 100).toFixed(2))
      : params.rail === 'SWIFT_TRANSFER'
      ? 12.0
      : params.rail === 'SEPA_INSTANT'
      ? 0.5
      : 0;
  const totalDebit = Number((params.amount + fee).toFixed(2));
  if (fromAcc.available_balance < totalDebit) {
    throw new Error(`Insufficient available balance. Needed ${totalDebit.toFixed(2)} ${fromAcc.currency}, available ${fromAcc.available_balance.toFixed(2)} ${fromAcc.currency}.`);
  }

  // Check if recipient IBAN belongs to an internal PRO MONEY account
  const internalRecipient = db.prepare('SELECT * FROM accounts WHERE iban = ? AND status = ?').get(params.recipientIban.trim().toUpperCase(), 'ACTIVE') as any;

  const txId = uid('tx');
  const now = new Date().toISOString();
  const ref = params.reference.trim() || `PM-TRF-${Math.floor(100000 + Math.random() * 899999)}`;
  const authCode = `AUTH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  // AML Velocity / High-Value Threshold Check (dynamic from system_operation_settings)
  const amlOp = getOperationSetting('AML_THRESHOLD');
  const amlThreshold = amlOp && amlOp.enabled && amlOp.max_amount > 0 ? amlOp.max_amount : 10000;
  const isHighValue = params.amount >= amlThreshold;
  const txStatus = isHighValue ? 'FLAGGED' : 'COMPLETED';

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO transactions (id, idempotency_key, tenant_id, user_id, from_account_id, to_account_id, counterparty_name, counterparty_iban, type, category, amount, fee, currency, direction, status, reference, source, authorization_code, is_sandbox, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Transfers', ?, ?, ?, 'OUT', ?, ?, ?, ?, 1, ?)`
    ).run(
      txId,
      idem,
      fromAcc.tenant_id,
      params.userId,
      fromAcc.id,
      internalRecipient ? internalRecipient.id : null,
      params.recipientName,
      params.recipientIban.trim().toUpperCase(),
      internalRecipient ? 'INTERNAL_TRANSFER' : params.rail,
      params.amount,
      fee,
      fromAcc.currency,
      txStatus,
      ref,
      internalRecipient ? 'CORE_INTERNAL_LEDGER' : `${params.rail}_SANDBOX`,
      authCode,
      now
    );

    // Debit Sender Account
    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
       VALUES (?, ?, ?, NULL, 'DEBIT', ?, ?, ?, ?)`
    ).run(uid('ldg'), txId, fromAcc.id, totalDebit, fromAcc.currency, `Transfer to ${params.recipientName} (${ref})`, now);

    if (internalRecipient && !isHighValue && internalRecipient.currency === fromAcc.currency) {
      // Credit Internal Recipient Account
      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
         VALUES (?, ?, ?, NULL, 'CREDIT', ?, ?, ?, ?)`
      ).run(uid('ldg'), txId, internalRecipient.id, params.amount, fromAcc.currency, `Incoming PRO MONEY transfer from ${fromAcc.iban}`, now);

      db.prepare(
        `UPDATE accounts SET available_balance = ROUND(available_balance + ?, 2), ledger_balance = ROUND(ledger_balance + ?, 2) WHERE id = ?`
      ).run(params.amount, params.amount, internalRecipient.id);

      // Also create recipient transaction view
      db.prepare(
        `INSERT INTO transactions (id, idempotency_key, tenant_id, user_id, from_account_id, to_account_id, counterparty_name, counterparty_iban, type, category, amount, fee, currency, direction, status, reference, source, authorization_code, is_sandbox, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INTERNAL_TRANSFER', 'Transfers', ?, 0, ?, 'IN', 'COMPLETED', ?, 'CORE_INTERNAL_LEDGER', ?, 1, ?)`
      ).run(uid('tx'), `${idem}_rx`, internalRecipient.tenant_id, internalRecipient.user_id, fromAcc.id, internalRecipient.id, fromAcc.label, fromAcc.iban, params.amount, fromAcc.currency, ref, authCode, now);
    } else {
      // Outbound clearing through active primary outflow bank pool
      const outflowPool = getPrimaryClearingPool('OUT');
      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
         VALUES (?, ?, NULL, ?, 'CREDIT', ?, ?, ?, ?)`
      ).run(uid('ldg'), txId, outflowPool.id, params.amount, fromAcc.currency, `Outbound clearing Pool ${outflowPool.code} (${outflowPool.bankName} · ${params.rail})`, now);

      const balanceOp = outflowPool.id === 'pool_D' ? '+' : '-';
      db.prepare(
        `UPDATE central_fund_pools SET balance = ROUND(balance ${balanceOp} ?, 2), updated_at = ? WHERE id = ?`
      ).run(params.amount, now, outflowPool.id);
    }

    if (fee > 0) {
      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
         VALUES (?, ?, NULL, 'pool_G', 'CREDIT', ?, ?, ?, ?)`
      ).run(uid('ldg'), txId, fee, fromAcc.currency, `Transfer fee (${params.rail})`, now);

      db.prepare(
        `UPDATE central_fund_pools SET balance = ROUND(balance + ?, 2), updated_at = ? WHERE id = 'pool_G'`
      ).run(fee, now);
    }

    if (isHighValue) {
      db.prepare(
        `UPDATE accounts SET available_balance = ROUND(available_balance - ?, 2), pending_amount = ROUND(pending_amount + ?, 2) WHERE id = ?`
      ).run(totalDebit, totalDebit, fromAcc.id);

      db.prepare(
        `INSERT INTO aml_fraud_cases (id, user_id, transaction_id, case_type, severity, risk_score, reason, status, created_at)
         VALUES (?, ?, ?, 'AML', 'HIGH', 78, ?, 'OPEN', ?)`
      ).run(uid('aml'), params.userId, txId, `High-value ${params.rail} transfer (${params.amount} ${fromAcc.currency}) queued for Compliance verification.`, now);
    } else {
      db.prepare(
        `UPDATE accounts SET available_balance = ROUND(available_balance - ?, 2), ledger_balance = ROUND(ledger_balance - ?, 2) WHERE id = ?`
      ).run(totalDebit, totalDebit, fromAcc.id);
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  createNotification(
    params.userId,
    isHighValue ? 'Transfer Pending Compliance Review' : 'Transfer Executed (Sandbox)',
    isHighValue
      ? `${params.amount.toFixed(2)} ${fromAcc.currency} to ${params.recipientName} held for AML review.`
      : `${params.amount.toFixed(2)} ${fromAcc.currency} sent to ${params.recipientName}.`,
    isHighValue ? 'WARNING' : 'SUCCESS'
  );
  maybeEmitHighValueAlert({
    userId: params.userId,
    tenantId: fromAcc.tenant_id,
    txId,
    amount: params.amount,
    currency: fromAcc.currency,
    counterpartyName: params.recipientName,
    typeLabel: internalRecipient ? 'Internal Transfer' : params.rail,
  });

  broadcastSync({ type: 'account:updated', targetUserId: params.userId, tenantId: fromAcc.tenant_id, data: { accountId: fromAcc.id, txId } });
  broadcastSync({ type: 'transaction:created', targetUserId: params.userId, tenantId: fromAcc.tenant_id, data: { txId } });
  if (internalRecipient) {
    broadcastSync({ type: 'account:updated', targetUserId: internalRecipient.user_id, tenantId: internalRecipient.tenant_id, data: { accountId: internalRecipient.id, txId } });
  }
  if (isHighValue) {
    broadcastSync({ type: 'compliance:updated', tenantId: fromAcc.tenant_id, data: { txId } });
  }

  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId);
}

export function executeFxConversion(params: {
  userId: string;
  fromAccountId: string;
  toAccountId: string;
  fromAmount: number;
  idempotencyKey?: string;
}) {
  if (params.fromAmount <= 0) throw new Error('Conversion amount must be greater than zero.');
  if (params.fromAccountId === params.toAccountId) throw new Error('Source and destination accounts must differ.');

  const idem = params.idempotencyKey || uid('idem');
  const existing = db.prepare('SELECT * FROM transactions WHERE idempotency_key = ?').get(idem);
  if (existing) return existing;

  const fromAcc = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(params.fromAccountId, params.userId) as any;
  const toAcc = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(params.toAccountId, params.userId) as any;
  if (!fromAcc || !toAcc) throw new Error('Both accounts must belong to the authenticated user.');
  if (fromAcc.currency === toAcc.currency) throw new Error('Accounts already share the same currency.');
  if (fromAcc.available_balance < params.fromAmount) throw new Error('Insufficient available balance for FX conversion.');

  // Lookup FX rate (direct or inverse or via EUR pivot)
  const direct = db.prepare('SELECT * FROM fx_rates WHERE base = ? AND quote = ?').get(fromAcc.currency, toAcc.currency) as any;
  const inverse = db.prepare('SELECT * FROM fx_rates WHERE base = ? AND quote = ?').get(toAcc.currency, fromAcc.currency) as any;
  let rate = 1;
  if (direct) {
    rate = direct.bid;
  } else if (inverse) {
    rate = Number((1 / inverse.ask).toFixed(6));
  } else {
    const leg1 = fromAcc.currency === 'EUR' ? 1 : (db.prepare('SELECT mid FROM fx_rates WHERE base = ? AND quote = ?').get('EUR', fromAcc.currency) as any)?.mid;
    const leg2 = toAcc.currency === 'EUR' ? 1 : (db.prepare('SELECT mid FROM fx_rates WHERE base = ? AND quote = ?').get('EUR', toAcc.currency) as any)?.mid;
    if (!leg1 || !leg2) throw new Error(`FX pair ${fromAcc.currency}/${toAcc.currency} is unavailable.`);
    rate = Number((leg2 / leg1).toFixed(6));
  }

  const feeBps = getMembershipFeeBps(params.userId);
  const feeFrom = Number(((params.fromAmount * feeBps) / 10000).toFixed(2));
  const netConvertedSource = params.fromAmount - feeFrom;
  const creditedTargetAmount = Number((netConvertedSource * rate).toFixed(2));

  const txId = uid('tx');
  const now = new Date().toISOString();
  const ref = `PM-FX-${Math.floor(100000 + Math.random() * 899999)}`;
  const authCode = `FX-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO transactions (id, idempotency_key, tenant_id, user_id, from_account_id, to_account_id, counterparty_name, counterparty_iban, type, category, amount, fee, currency, direction, status, reference, source, authorization_code, is_sandbox, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FX_EXCHANGE', 'Currency Exchange', ?, ?, ?, 'INTERNAL', 'COMPLETED', ?, 'FX_ENGINE_SANDBOX', ?, 1, ?)`
    ).run(
      txId,
      idem,
      fromAcc.tenant_id,
      params.userId,
      fromAcc.id,
      toAcc.id,
      `${fromAcc.currency} -> ${toAcc.currency} @ ${rate.toFixed(4)}`,
      toAcc.iban,
      params.fromAmount,
      feeFrom,
      fromAcc.currency as CurrencyCode,
      ref,
      authCode,
      now
    );

    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
       VALUES (?, ?, ?, NULL, 'DEBIT', ?, ?, ?, ?)`
    ).run(uid('ldg'), txId, fromAcc.id, params.fromAmount, fromAcc.currency, `FX sell ${params.fromAmount} ${fromAcc.currency}`, now);

    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
       VALUES (?, ?, NULL, 'pool_F', 'CREDIT', ?, ?, ?, ?)`
    ).run(uid('ldg'), txId, netConvertedSource, fromAcc.currency, `FX Liquidity Pool F intake (${fromAcc.currency})`, now);

    if (feeFrom > 0) {
      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
         VALUES (?, ?, NULL, 'pool_G', 'CREDIT', ?, ?, ?, ?)`
      ).run(uid('ldg'), txId, feeFrom, fromAcc.currency, `FX spread fee (${feeBps} bps)`, now);
    }

    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
       VALUES (?, ?, NULL, 'pool_F', 'DEBIT', ?, ?, ?, ?)`
    ).run(uid('ldg'), txId, creditedTargetAmount, toAcc.currency, `FX Liquidity Pool F disbursement (${toAcc.currency})`, now);

    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
       VALUES (?, ?, ?, NULL, 'CREDIT', ?, ?, ?, ?)`
    ).run(uid('ldg'), txId, toAcc.id, creditedTargetAmount, toAcc.currency, `FX buy ${creditedTargetAmount} ${toAcc.currency} @ ${rate}`, now);

    db.prepare(
      `UPDATE accounts SET available_balance = ROUND(available_balance - ?, 2), ledger_balance = ROUND(ledger_balance - ?, 2) WHERE id = ?`
    ).run(params.fromAmount, params.fromAmount, fromAcc.id);

    db.prepare(
      `UPDATE accounts SET available_balance = ROUND(available_balance + ?, 2), ledger_balance = ROUND(ledger_balance + ?, 2) WHERE id = ?`
    ).run(creditedTargetAmount, creditedTargetAmount, toAcc.id);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  createNotification(
    params.userId,
    'FX Conversion Completed',
    `Converted ${params.fromAmount.toFixed(2)} ${fromAcc.currency} to ${creditedTargetAmount.toFixed(2)} ${toAcc.currency} at ${rate.toFixed(4)}.`,
    'SUCCESS'
  );
  maybeEmitHighValueAlert({
    userId: params.userId,
    tenantId: fromAcc.tenant_id,
    txId,
    amount: params.fromAmount,
    currency: fromAcc.currency,
    counterpartyName: `${fromAcc.currency} -> ${toAcc.currency}`,
    typeLabel: 'FX Exchange',
  });
  broadcastSync({ type: 'account:updated', targetUserId: params.userId, tenantId: fromAcc.tenant_id, data: { txId } });
  broadcastSync({ type: 'transaction:created', targetUserId: params.userId, tenantId: fromAcc.tenant_id, data: { txId } });

  return {
    transaction: db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId),
    creditedAmount: creditedTargetAmount,
    rate,
    fee: feeFrom,
  };
}

export function executeReversal(params: {
  actorUserId: string;
  actorEmail: string;
  actorRole: string;
  transactionId: string;
  reason: string;
}) {
  const orig = db.prepare('SELECT * FROM transactions WHERE id = ?').get(params.transactionId) as any;
  if (!orig) throw new Error('Transaction not found.');
  if (orig.status === 'REVERSED') throw new Error('Transaction is already reversed.');

  const revTxId = uid('tx');
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO transactions (id, idempotency_key, tenant_id, user_id, from_account_id, to_account_id, counterparty_name, counterparty_iban, type, category, amount, fee, currency, direction, status, reference, source, authorization_code, is_sandbox, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'REVERSAL', 'Reversal', ?, 0, ?, ?, 'COMPLETED', ?, 'CORE_REVERSAL_ENGINE', ?, 1, ?)`
    ).run(
      revTxId,
      `rev_${orig.id}`,
      orig.tenant_id,
      orig.user_id,
      orig.to_account_id,
      orig.from_account_id,
      `Reversal: ${orig.counterparty_name}`,
      orig.counterparty_iban,
      orig.amount,
      orig.currency,
      orig.direction === 'OUT' ? 'IN' : 'OUT',
      `REV-${orig.reference}`,
      `REV-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      now
    );

    // Post opposing ledger entries (never delete original ledger rows!)
    const origEntries = db.prepare('SELECT * FROM ledger_entries WHERE transaction_id = ?').all(orig.id) as any[];
    for (const entry of origEntries) {
      const oppType = entry.entry_type === 'DEBIT' ? 'CREDIT' : 'DEBIT';
      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(uid('ldg'), revTxId, entry.account_id, entry.pool_id, oppType, entry.amount, entry.currency, `Reversal of ${orig.reference}: ${params.reason}`, now);

      if (entry.account_id) {
        const delta = oppType === 'CREDIT' ? entry.amount : -entry.amount;
        db.prepare(
          `UPDATE accounts SET available_balance = ROUND(available_balance + ?, 2), ledger_balance = ROUND(ledger_balance + ?, 2) WHERE id = ?`
        ).run(delta, delta, entry.account_id);
      }
      if (entry.pool_id) {
        const delta = oppType === 'CREDIT' ? entry.amount : -entry.amount;
        db.prepare(`UPDATE central_fund_pools SET balance = ROUND(balance + ?, 2), updated_at = ? WHERE id = ?`).run(delta, now, entry.pool_id);
      }
    }

    db.prepare(`UPDATE transactions SET status = 'REVERSED' WHERE id = ?`).run(orig.id);

    writeAuditLog({
      actorUserId: params.actorUserId,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      action: 'TRANSACTION_REVERSAL',
      targetType: 'TRANSACTION',
      targetId: orig.id,
      metadata: `Reversed via ${revTxId}: ${params.reason}`,
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcastSync({ type: 'account:updated', targetUserId: orig.user_id, tenantId: orig.tenant_id, data: { txId: revTxId } });
  broadcastSync({ type: 'transaction:created', targetUserId: orig.user_id, tenantId: orig.tenant_id, data: { txId: revTxId } });
  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(revTxId);
}

export function adjustCentralFundPool(params: {
  actorUserId: string;
  actorEmail: string;
  actorRole: string;
  tenantId: string;
  poolId: string;
  direction: 'CREDIT' | 'DEBIT';
  amount: number;
  reason: string;
  custodianStatus?: string;
}) {
  if (!Number.isFinite(params.amount) || params.amount <= 0 || params.amount > 100000000) {
    throw new Error('Adjustment amount must be positive and valid.');
  }
  const pool = db.prepare('SELECT * FROM central_fund_pools WHERE id = ?').get(params.poolId) as any;
  if (!pool) throw new Error('Central fund pool not found.');
  if (params.direction === 'DEBIT' && Number(pool.balance) < params.amount) {
    throw new Error(`Insufficient balance in Pool ${pool.code} (${pool.balance} ${pool.currency}).`);
  }

  const txId = uid('tx');
  const now = new Date().toISOString();
  const ref = `PM-POOL-${pool.code}-${Math.floor(10000 + Math.random() * 89999)}`;
  const authCode = `TRES-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const reason = params.reason.trim() || `Treasury ${params.direction.toLowerCase()} for Pool ${pool.code}`;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO transactions (id, idempotency_key, tenant_id, user_id, from_account_id, to_account_id, counterparty_name, counterparty_iban, type, category, amount, fee, currency, direction, status, reference, source, authorization_code, is_sandbox, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, 'Treasury Pool Adjustment', ?, 0, ?, ?, 'COMPLETED', ?, 'TREASURY_POOL_CONSOLE', ?, 1, ?)`
    ).run(
      txId,
      uid('idem'),
      params.tenantId,
      params.actorUserId,
      `Central Pool ${pool.code} (${pool.name})`,
      `POOL-${pool.code}-RESERVE`,
      params.direction === 'CREDIT' ? 'DEPOSIT' : 'WITHDRAWAL',
      params.amount,
      pool.currency,
      params.direction === 'CREDIT' ? 'IN' : 'OUT',
      ref,
      authCode,
      now
    );

    if (params.direction === 'CREDIT') {
      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
         VALUES (?, ?, NULL, NULL, 'DEBIT', ?, ?, ?, ?)`
      ).run(uid('ldg'), txId, params.amount, pool.currency, `External treasury reserve intake for Pool ${pool.code}: ${reason}`, now);

      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
         VALUES (?, ?, NULL, ?, 'CREDIT', ?, ?, ?, ?)`
      ).run(uid('ldg'), txId, pool.id, params.amount, pool.currency, `Credit Pool ${pool.code}: ${reason}`, now);

      db.prepare(
        `UPDATE central_fund_pools SET balance = ROUND(balance + ?, 2), custodian_status = COALESCE(?, custodian_status), updated_at = ? WHERE id = ?`
      ).run(params.amount, params.custodianStatus || null, now, pool.id);
    } else {
      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
         VALUES (?, ?, NULL, ?, 'DEBIT', ?, ?, ?, ?)`
      ).run(uid('ldg'), txId, pool.id, params.amount, pool.currency, `Debit Pool ${pool.code}: ${reason}`, now);

      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
         VALUES (?, ?, NULL, NULL, 'CREDIT', ?, ?, ?, ?)`
      ).run(uid('ldg'), txId, params.amount, pool.currency, `External treasury disbursement from Pool ${pool.code}: ${reason}`, now);

      db.prepare(
        `UPDATE central_fund_pools SET balance = ROUND(balance - ?, 2), custodian_status = COALESCE(?, custodian_status), updated_at = ? WHERE id = ?`
      ).run(params.amount, params.custodianStatus || null, now, pool.id);
    }

    writeAuditLog({
      actorUserId: params.actorUserId,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      action: `CENTRAL_POOL_${params.direction}`,
      targetType: 'CENTRAL_FUND_POOL',
      targetId: pool.id,
      metadata: `Pool ${pool.code} ${params.direction} ${params.amount} ${pool.currency}: ${reason}`,
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcastSync({ type: 'admin:sync', tenantId: params.tenantId, data: { event: 'POOL_ADJUSTED', poolId: pool.id, txId } });
  return db.prepare('SELECT * FROM central_fund_pools WHERE id = ?').get(pool.id);
}

export function transferBetweenCentralFundPools(params: {
  actorUserId: string;
  actorEmail: string;
  actorRole: string;
  tenantId: string;
  fromPoolId: string;
  toPoolId: string;
  amount: number;
  reason: string;
}) {
  if (params.fromPoolId === params.toPoolId) {
    throw new Error('Source and destination pools must be different.');
  }
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error('Transfer amount must be positive.');
  }

  const fromPool = db.prepare('SELECT * FROM central_fund_pools WHERE id = ?').get(params.fromPoolId) as any;
  const toPool = db.prepare('SELECT * FROM central_fund_pools WHERE id = ?').get(params.toPoolId) as any;
  if (!fromPool || !toPool) throw new Error('Selected fund pool not found.');
  if (Number(fromPool.balance) < params.amount) {
    throw new Error(`Insufficient balance in Pool ${fromPool.code} (${fromPool.balance} ${fromPool.currency}).`);
  }

  const txId = uid('tx');
  const now = new Date().toISOString();
  const ref = `PM-POOL-XFER-${Math.floor(10000 + Math.random() * 89999)}`;
  const authCode = `PXF-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const reason = params.reason.trim() || `Rebalance Pool ${fromPool.code} -> Pool ${toPool.code}`;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO transactions (id, idempotency_key, tenant_id, user_id, from_account_id, to_account_id, counterparty_name, counterparty_iban, type, category, amount, fee, currency, direction, status, reference, source, authorization_code, is_sandbox, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, 'INTERNAL_TRANSFER', 'Inter-Pool Rebalance', ?, 0, ?, 'INTERNAL', 'COMPLETED', ?, 'TREASURY_POOL_TRANSFER', ?, 1, ?)`
    ).run(
      txId,
      uid('idem'),
      params.tenantId,
      params.actorUserId,
      `Pool ${fromPool.code} -> Pool ${toPool.code}`,
      `POOL-${fromPool.code}-TO-${toPool.code}`,
      params.amount,
      fromPool.currency,
      ref,
      authCode,
      now
    );

    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
       VALUES (?, ?, NULL, ?, 'DEBIT', ?, ?, ?, ?)`
    ).run(uid('ldg'), txId, fromPool.id, params.amount, fromPool.currency, `Inter-pool debit Pool ${fromPool.code} -> Pool ${toPool.code}: ${reason}`, now);

    db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
       VALUES (?, ?, NULL, ?, 'CREDIT', ?, ?, ?, ?)`
    ).run(uid('ldg'), txId, toPool.id, params.amount, toPool.currency, `Inter-pool credit Pool ${toPool.code} <- Pool ${fromPool.code}: ${reason}`, now);

    db.prepare(`UPDATE central_fund_pools SET balance = ROUND(balance - ?, 2), updated_at = ? WHERE id = ?`).run(
      params.amount,
      now,
      fromPool.id
    );
    db.prepare(`UPDATE central_fund_pools SET balance = ROUND(balance + ?, 2), updated_at = ? WHERE id = ?`).run(
      params.amount,
      now,
      toPool.id
    );

    writeAuditLog({
      actorUserId: params.actorUserId,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      action: 'CENTRAL_POOL_TRANSFER',
      targetType: 'CENTRAL_FUND_POOL',
      targetId: `${fromPool.id}->${toPool.id}`,
      metadata: `Transferred ${params.amount} ${fromPool.currency} from Pool ${fromPool.code} to Pool ${toPool.code}: ${reason}`,
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcastSync({ type: 'pool:updated', tenantId: params.tenantId, data: { event: 'POOL_TRANSFERRED', txId } });
  broadcastSync({ type: 'admin:sync', tenantId: params.tenantId, data: { event: 'POOL_TRANSFERRED', txId } });
  return {
    fromPool: db.prepare('SELECT * FROM central_fund_pools WHERE id = ?').get(fromPool.id),
    toPool: db.prepare('SELECT * FROM central_fund_pools WHERE id = ?').get(toPool.id),
    txId,
  };
}

export function createCentralFundPool(params: {
  actorUserId: string;
  actorEmail: string;
  actorRole: string;
  tenantId: string;
  code: string;
  name: string;
  bankName: string;
  iban?: string;
  bic?: string;
  category?: string;
  currency: string;
  initialBalance?: number;
  segregated?: boolean;
  custodianStatus?: string;
  routingMode?: 'ALL' | 'INFLOW' | 'OUTFLOW' | 'STANDBY';
  setAsPrimaryClearing?: boolean;
}) {
  const code = params.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!code || code.length > 8) {
    throw new Error('Havuz kodu 1-8 karakter (harf/rakam) olmalıdır.');
  }
  const existingCode = db.prepare('SELECT id FROM central_fund_pools WHERE UPPER(code) = ?').get(code);
  if (existingCode) {
    throw new Error(`'${code}' kodlu havuz zaten mevcut.`);
  }
  const name = params.name.trim();
  const bankName = params.bankName.trim();
  if (!name || !bankName) {
    throw new Error('Havuz adı ve anlaşmalı banka adı zorunludur.');
  }
  const currency = (params.currency || 'TRY').trim().toUpperCase();
  const initialBalance = Number(params.initialBalance ?? 0);
  if (!Number.isFinite(initialBalance) || initialBalance < 0 || initialBalance > 1000000000) {
    throw new Error('Açılış bakiyesi geçersiz.');
  }

  const routingModeRaw = String(params.routingMode || (params.setAsPrimaryClearing ? 'ALL' : 'STANDBY')).toUpperCase();
  const routingMode = (['ALL', 'INFLOW', 'OUTFLOW', 'STANDBY'].includes(routingModeRaw)
    ? routingModeRaw
    : 'STANDBY') as 'ALL' | 'INFLOW' | 'OUTFLOW' | 'STANDBY';

  const poolId = `pool_${code}_${crypto.randomBytes(2).toString('hex')}`;
  const now = new Date().toISOString();
  const iban = params.iban?.trim().toUpperCase() || null;
  const bic = params.bic?.trim().toUpperCase() || null;
  const category = params.category?.trim() || 'Partner Bank Clearing Pool';
  const custodianStatus = params.custodianStatus?.trim() || `${bankName} · Aktif Bağlı Banka Havuzu`;
  const segregated = params.segregated !== undefined ? (params.segregated ? 1 : 0) : 1;
  const isPrimary = params.setAsPrimaryClearing ? 1 : 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    if (isPrimary) {
      db.prepare('UPDATE central_fund_pools SET is_primary_clearing = 0').run();
    }

    db.prepare(
      `INSERT INTO central_fund_pools (
         id, code, name, category, currency, balance, segregated, custodian_status,
         bank_name, iban, bic, is_primary_clearing, routing_mode, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      poolId,
      code,
      name,
      category,
      currency,
      initialBalance,
      segregated,
      custodianStatus,
      bankName,
      iban,
      bic,
      isPrimary,
      isPrimary && routingMode === 'STANDBY' ? 'ALL' : routingMode,
      now
    );

    if (initialBalance > 0) {
      const txId = uid('tx');
      const ref = `PM-POOL-INIT-${code}`;
      const authCode = `POOL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      db.prepare(
        `INSERT INTO transactions (id, idempotency_key, tenant_id, user_id, from_account_id, to_account_id, counterparty_name, counterparty_iban, type, category, amount, fee, currency, direction, status, reference, source, authorization_code, is_sandbox, created_at)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, 'DEPOSIT', 'Partner Bank Pool Capitalization', ?, 0, ?, 'IN', 'COMPLETED', ?, 'TREASURY_POOL_CONSOLE', ?, 1, ?)`
      ).run(txId, uid('idem'), params.tenantId, params.actorUserId, `${bankName} (${name})`, iban || `POOL-${code}`, initialBalance, currency, ref, authCode, now);

      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
         VALUES (?, ?, NULL, NULL, 'DEBIT', ?, ?, ?, ?)`
      ).run(uid('ldg'), txId, initialBalance, currency, `External partner bank capital intake (${bankName} · Pool ${code})`, now);

      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
         VALUES (?, ?, NULL, ?, 'CREDIT', ?, ?, ?, ?)`
      ).run(uid('ldg'), txId, poolId, initialBalance, currency, `Initial partner bank pool balance (${bankName} · Pool ${code})`, now);
    }

    writeAuditLog({
      actorUserId: params.actorUserId,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      action: 'CENTRAL_POOL_CREATED',
      targetType: 'CENTRAL_FUND_POOL',
      targetId: poolId,
      metadata: `Created Pool ${code} (${bankName} · ${name}) ${initialBalance} ${currency}, primary=${isPrimary}, routing=${routingMode}`,
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcastSync({ type: 'pool:updated', tenantId: params.tenantId, data: { event: 'POOL_CREATED', poolId } });
  broadcastSync({ type: 'admin:sync', tenantId: params.tenantId, data: { event: 'POOL_CREATED', poolId } });
  return db.prepare('SELECT * FROM central_fund_pools WHERE id = ?').get(poolId);
}
