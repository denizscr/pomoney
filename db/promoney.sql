-- =============================================================================
-- PRO MONEY — Complete SQL Database Schema & Seed Script (SQLite / PostgreSQL)
-- Canlı anlık veritabanı yedeği Admin Panelinden (.sql olarak indir) veya
-- GET /api/admin/export.sql üzerinden her an indirilebilir.
-- =============================================================================

PRAGMA foreign_keys = ON;

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

-- =============================================================================
-- Seeded Core Tenants & Central Fund / Partner Bank Pools
-- =============================================================================
INSERT OR IGNORE INTO tenants (id, name, domain, primary_color, accent_color, status, created_at) VALUES
  ('tenant_promoney_core', 'PRO MONEY Core Banking', 'app.promoney.io', '#09090B', '#F97316', 'ACTIVE', '2026-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO central_fund_pools (id, code, name, category, currency, balance, segregated, custodian_status, bank_name, iban, bic, is_primary_clearing, routing_mode, updated_at) VALUES
  ('pool_A', 'A', 'Safeguarded Customer Funds', 'Client Money Ring-Fenced Pool', 'EUR', 96450.00, 1, 'SEGREGATED_CUSTODY', 'PRO MONEY Safeguarding Partner Bank', 'DE89500105175407000001', 'PMNYDEFFXXX', 1, 'ALL', '2026-01-01T00:00:00.000Z'),
  ('pool_B', 'B', 'Company Operational Funds', 'PRO MONEY Corporate OpEx', 'EUR', 450000.00, 1, 'INTERNAL_TREASURY', 'PRO MONEY Treasury Ops', 'DE44500105175407324999', 'PMNYDEFFXXX', 0, 'STANDBY', '2026-01-01T00:00:00.000Z'),
  ('pool_C', 'C', 'Card Settlement Funds', 'Visa / Mastercard / TROY Clearing', 'EUR', 28400.00, 1, 'BIN_SPONSOR_CLEARING', 'PRO MONEY BIN Sponsor', 'DE12500105175407324800', 'PMNYDEFFXXX', 0, 'STANDBY', '2026-01-01T00:00:00.000Z'),
  ('pool_D', 'D', 'Payment Settlement Funds', 'POS & Payment Gateway Clearing', 'EUR', 42150.00, 1, 'ACQUIRER_CLEARING', 'PRO MONEY Acquiring Partner', 'DE71500105175407324777', 'PMNYDEFFXXX', 0, 'STANDBY', '2026-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO system_operation_settings (key, label, enabled, fee_fixed, fee_percent, max_amount, updated_by, updated_at) VALUES
  ('TRANSFER_SEPA', 'SEPA / Yerel Transferler', 1, 0, 0, 250000, 'system', '2026-01-01T00:00:00.000Z'),
  ('TRANSFER_SWIFT', 'SWIFT Uluslararası Havale', 1, 15, 0.1, 500000, 'system', '2026-01-01T00:00:00.000Z'),
  ('POS_ONLINE', 'Online Sanal/Fiziki POS Tahsilatı', 1, 0.25, 1.49, 100000, 'system', '2026-01-01T00:00:00.000Z'),
  ('POS_OFFLINE', 'Offline POS Kuyruk İşlemleri', 1, 0.5, 1.85, 10000, 'system', '2026-01-01T00:00:00.000Z'),
  ('CARD_TOPUP', 'Kart Bakiye Yükleme / Karttan Yükleme', 1, 0, 0.4, 50000, 'system', '2026-01-01T00:00:00.000Z'),
  ('FX_EXCHANGE', 'Çoklu Döviz Alım / Satım', 1, 0, 0.2, 200000, 'system', '2026-01-01T00:00:00.000Z'),
  ('LOAN_DISBURSE', 'Anında Kredi Kullandırma', 1, 25, 0, 150000, 'system', '2026-01-01T00:00:00.000Z');
