-- PRO MONEY — Production PostgreSQL Schema & Row-Level Security (RLS) Migration
-- Target: PostgreSQL 15+ (Cloud SQL / RDS / Managed Postgres)
-- Note: Embedded runtime uses SQLite (node:sqlite) in Sandbox/Dev; apply this DDL when deploying to Production PostgreSQL.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  primary_color TEXT NOT NULL DEFAULT '#09090B',
  accent_color TEXT NOT NULL DEFAULT '#E11D74',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
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
  identity_verified BOOLEAN NOT NULL DEFAULT FALSE,
  passport_verified BOOLEAN NOT NULL DEFAULT FALSE,
  address_verified BOOLEAN NOT NULL DEFAULT FALSE,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  passkey_count INTEGER NOT NULL DEFAULT 0,
  high_value_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  high_value_alert_threshold NUMERIC(18, 2) NOT NULL DEFAULT 5000,
  biometric_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  locked_until TIMESTAMPTZ,
  lock_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  business_id TEXT,
  account_number TEXT NOT NULL UNIQUE,
  iban TEXT NOT NULL UNIQUE,
  bic TEXT NOT NULL,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  currency TEXT NOT NULL,
  available_balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ledger_balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  blocked_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  pending_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  is_sandbox BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS central_fund_pools (
  id TEXT PRIMARY KEY,
  code VARCHAR(16) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  currency TEXT NOT NULL,
  balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  segregated BOOLEAN NOT NULL DEFAULT TRUE,
  custodian_status TEXT NOT NULL,
  bank_name TEXT,
  iban TEXT,
  bic TEXT,
  is_primary_clearing BOOLEAN NOT NULL DEFAULT FALSE,
  routing_mode TEXT NOT NULL DEFAULT 'STANDBY',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  from_account_id TEXT REFERENCES accounts(id),
  to_account_id TEXT REFERENCES accounts(id),
  counterparty_name TEXT NOT NULL,
  counterparty_iban TEXT,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC(18, 4) NOT NULL,
  fee NUMERIC(18, 4) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  reference TEXT NOT NULL,
  source TEXT NOT NULL,
  authorization_code TEXT NOT NULL,
  is_sandbox BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  account_id TEXT REFERENCES accounts(id),
  pool_id TEXT REFERENCES central_fund_pools(id),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT')),
  amount NUMERIC(18, 4) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  holder_name TEXT NOT NULL,
  pan_formatted TEXT,
  last4 CHAR(4) NOT NULL,
  issuer_label TEXT,
  credit_limit NUMERIC(18, 2) NOT NULL DEFAULT 0,
  expiry TEXT NOT NULL,
  scheme TEXT NOT NULL,
  product_type TEXT NOT NULL,
  design_variant TEXT NOT NULL,
  status TEXT NOT NULL,
  online_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  contactless_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  atm_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  daily_limit NUMERIC(18, 2) NOT NULL,
  monthly_limit NUMERIC(18, 2) NOT NULL,
  spent_today NUMERIC(18, 2) NOT NULL DEFAULT 0,
  spent_month NUMERIC(18, 2) NOT NULL DEFAULT 0,
  delivery_status TEXT NOT NULL,
  is_sandbox BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_terminals (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  owner_user_id TEXT REFERENCES users(id),
  serial_number TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL,
  location_name TEXT NOT NULL,
  status TEXT NOT NULL,
  terminal_mode TEXT NOT NULL DEFAULT 'ONLINE',
  approval_status TEXT NOT NULL DEFAULT 'APPROVED',
  online_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  offline_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  offline_floor_limit NUMERIC(18, 2) NOT NULL DEFAULT 2500,
  offline_queued_count INTEGER NOT NULL DEFAULT 0,
  offline_queued_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  supports_contactless BOOLEAN NOT NULL DEFAULT TRUE,
  supports_qr BOOLEAN NOT NULL DEFAULT TRUE,
  supports_offline_rules BOOLEAN NOT NULL DEFAULT TRUE,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS offline_pos_queue (
  id TEXT PRIMARY KEY,
  terminal_id TEXT NOT NULL REFERENCES pos_terminals(id),
  merchant_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  amount NUMERIC(18, 2) NOT NULL,
  currency TEXT NOT NULL,
  card_last4 CHAR(4) NOT NULL,
  card_scheme TEXT NOT NULL,
  reference TEXT NOT NULL,
  auth_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED_OFFLINE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_entitlements (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  allow_pos_online BOOLEAN NOT NULL DEFAULT FALSE,
  allow_pos_offline BOOLEAN NOT NULL DEFAULT FALSE,
  allow_swift BOOLEAN NOT NULL DEFAULT TRUE,
  allow_credit_cards BOOLEAN NOT NULL DEFAULT TRUE,
  allow_debit_cards BOOLEAN NOT NULL DEFAULT TRUE,
  allow_card_topup BOOLEAN NOT NULL DEFAULT TRUE,
  allow_loans BOOLEAN NOT NULL DEFAULT TRUE,
  allow_qr_bills BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_operation_settings (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  fee_fixed NUMERIC(18, 2) NOT NULL DEFAULT 0,
  fee_percent NUMERIC(8, 4) NOT NULL DEFAULT 0,
  max_amount NUMERIC(18, 2) NOT NULL DEFAULT 500000,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL,
  category TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'TICKET',
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id),
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_role TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce Immutable Ledger (Append-Only Double Entry)
CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'PRO MONEY Ledger entries are immutable. Use reversing entries instead.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_immutable_ledger ON ledger_entries;
CREATE TRIGGER trg_immutable_ledger
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

-- Row Level Security (Tenant & Customer Isolation)
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounts_tenant_user_isolation ON accounts
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)
    AND (
      user_id = current_setting('app.current_user_id', true)
      OR current_setting('app.current_role', true) IN ('SUPER_ADMIN', 'FINANCE_ADMIN', 'AUDITOR')
    )
  );
