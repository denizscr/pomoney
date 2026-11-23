export type UserRole =
  | 'SUPER_ADMIN'
  | 'SYSTEM_ADMIN'
  | 'FINANCE_ADMIN'
  | 'COMPLIANCE_OFFICER'
  | 'AML_OFFICER'
  | 'RISK_MANAGER'
  | 'BRANCH_MANAGER'
  | 'CUSTOMER_SUPPORT'
  | 'BUSINESS_MANAGER'
  | 'MERCHANT'
  | 'AUDITOR'
  | 'INDIVIDUAL_CUSTOMER'
  | 'CORPORATE_CUSTOMER';

export type AccountType =
  | 'PERSONAL'
  | 'BUSINESS'
  | 'MULTI_CURRENCY'
  | 'SAVINGS'
  | 'JOINT'
  | 'CORPORATE';

export type CurrencyCode = 'EUR' | 'USD' | 'GBP' | 'CHF' | 'TRY' | 'SAR' | 'AED';

export type CardScheme = 'VISA' | 'MASTERCARD' | 'TROY';

export type CardProductType =
  | 'DEBIT'
  | 'CREDIT'
  | 'PREPAID'
  | 'VIRTUAL'
  | 'PHYSICAL'
  | 'BUSINESS'
  | 'CORPORATE'
  | 'PREMIUM'
  | 'ADDITIONAL';

export type MembershipTier =
  | 'Standard'
  | 'Silver'
  | 'Gold'
  | 'Platinum'
  | 'Black'
  | 'Business'
  | 'Corporate';

export type ReadinessStatus =
  | 'Implemented'
  | 'Tested'
  | 'Connected'
  | 'Sandbox Only'
  | 'Requires Provider'
  | 'Requires Contract'
  | 'Requires License'
  | 'Requires Certification'
  | 'Production Authorized'
  | 'Production Active';

export interface TenantConfig {
  id: string;
  name: string;
  domain: string;
  primaryColor: string;
  accentColor: string;
  status: string;
}

export type ApprovalStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export type VerificationType = 'IDENTITY_CARD' | 'PASSPORT' | 'ADDRESS' | 'PHONE';
export type VerificationStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface IdentityVerificationRecord {
  id: string;
  userId: string;
  subjectName?: string;
  customerNumber?: string;
  verificationType: VerificationType;
  documentNumber?: string | null;
  issuingCountry?: string | null;
  expiryDate?: string | null;
  addressFull?: string | null;
  city?: string | null;
  postalCode?: string | null;
  phoneNumber?: string | null;
  proofReference?: string | null;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  rejectionReason?: string | null;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  tenantId: string;
  customerNumber: string;
  email: string;
  fullName: string;
  phone: string;
  country: string;
  role: UserRole;
  accountCategory: 'Personal' | 'Business' | 'Corporate' | 'Employee' | 'Merchant' | 'Administrator';
  membershipTier: MembershipTier;
  kycStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  approvalStatus: ApprovalStatus;
  requestedCompanyName?: string | null;
  requestedTaxId?: string | null;
  nationalIdNumber?: string | null;
  passportNumber?: string | null;
  addressLine?: string | null;
  city?: string | null;
  postalCode?: string | null;
  identityVerified: boolean;
  passportVerified: boolean;
  addressVerified: boolean;
  phoneVerified: boolean;
  mfaEnabled: boolean;
  passkeyCount: number;
  highValueAlertsEnabled?: boolean;
  highValueAlertThreshold?: number;
  biometricEnabled?: boolean;
  failedLoginAttempts?: number;
  isLocked?: boolean;
  lockedUntil?: string | null;
  lockReason?: string | null;
  entitlements?: UserEntitlementsRecord;
  createdAt: string;
}

export interface UserEntitlementsRecord {
  userId: string;
  allowPosOnline: boolean;
  allowPosOffline: boolean;
  allowSwift: boolean;
  allowCreditCards: boolean;
  allowDebitCards: boolean;
  allowCardTopup: boolean;
  allowLoans: boolean;
  allowQrBills: boolean;
  updatedBy?: string | null;
  updatedAt?: string;
}

export interface SystemOperationSettingRecord {
  key: string;
  label: string;
  enabled: boolean;
  feeFixed: number;
  feePercent: number;
  maxAmount: number;
  updatedBy?: string | null;
  updatedAt?: string;
}

export interface OfflinePosQueueItem {
  id: string;
  terminalId: string;
  terminalSerial?: string | null;
  terminalLocation?: string | null;
  merchantId: string;
  ownerUserId: string;
  amount: number;
  currency: CurrencyCode;
  cardLast4: string;
  cardScheme: string;
  reference: string;
  authCode: string;
  status: 'QUEUED_OFFLINE' | 'SETTLED' | 'REJECTED';
  createdAt: string;
  settledAt?: string | null;
}

export interface BankAccount {
  id: string;
  tenantId: string;
  userId: string;
  businessId?: string | null;
  accountNumber: string;
  iban: string;
  bic: string;
  type: AccountType;
  label: string;
  currency: CurrencyCode;
  availableBalance: number;
  ledgerBalance: number;
  blockedAmount: number;
  pendingAmount: number;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  isSandbox: boolean;
  createdAt: string;
}

export interface CentralFundPool {
  id: string;
  code: string;
  name: string;
  category: string;
  currency: CurrencyCode;
  balance: number;
  segregated: boolean;
  custodianStatus: string;
  bankName?: string | null;
  iban?: string | null;
  bic?: string | null;
  isPrimaryClearing?: boolean;
  routingMode?: 'ALL' | 'INFLOW' | 'OUTFLOW' | 'STANDBY';
  updatedAt: string;
}

export interface BankCard {
  id: string;
  tenantId: string;
  userId: string;
  accountId: string;
  holderName: string;
  maskedPan?: string;
  last4: string;
  issuerLabel?: string | null;
  creditLimit?: number;
  expiry: string;
  scheme: CardScheme;
  productType: CardProductType;
  designVariant: 'OBSIDIAN' | 'ROSE_METAL' | 'CHAMPAGNE_GOLD' | 'CORPORATE_SLATE';
  status: 'ACTIVE' | 'FROZEN' | 'CANCELLED' | 'PENDING_DELIVERY';
  onlineEnabled: boolean;
  contactlessEnabled: boolean;
  atmEnabled: boolean;
  dailyLimit: number;
  monthlyLimit: number;
  spentToday: number;
  spentMonth: number;
  deliveryStatus: string;
  isSandbox: boolean;
  createdAt: string;
}

export interface TransactionRecord {
  id: string;
  idempotencyKey: string;
  tenantId: string;
  userId: string;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  counterpartyName: string;
  counterpartyIban?: string | null;
  type:
    | 'DEPOSIT'
    | 'WITHDRAWAL'
    | 'INTERNAL_TRANSFER'
    | 'SEPA_TRANSFER'
    | 'SEPA_INSTANT'
    | 'SWIFT_TRANSFER'
    | 'FX_EXCHANGE'
    | 'CARD_PAYMENT'
    | 'POS_PAYMENT'
    | 'QR_PAYMENT'
    | 'BILL_PAYMENT'
    | 'SAVINGS_TRANSFER'
    | 'LOAN_DISBURSEMENT'
    | 'LOAN_REPAYMENT'
    | 'REFUND'
    | 'REVERSAL';
  category: string;
  amount: number;
  fee: number;
  currency: CurrencyCode;
  direction: 'IN' | 'OUT' | 'INTERNAL';
  status: 'COMPLETED' | 'PENDING' | 'FLAGGED' | 'FAILED' | 'REVERSED';
  reference: string;
  source: string;
  authorizationCode: string;
  isSandbox: boolean;
  createdAt: string;
}

export interface LedgerEntryRecord {
  id: string;
  transactionId: string;
  accountId: string | null;
  poolId: string | null;
  entryType: 'DEBIT' | 'CREDIT';
  amount: number;
  currency: CurrencyCode;
  description: string;
  createdAt: string;
}

export interface Beneficiary {
  id: string;
  userId: string;
  name: string;
  iban: string;
  bic: string;
  bankName: string;
  currency: CurrencyCode;
  country: string;
  isTrusted: boolean;
}

export interface FxRate {
  pair: string;
  base: CurrencyCode;
  quote: CurrencyCode;
  bid: number;
  ask: number;
  mid: number;
  source: string;
  updatedAt: string;
}

export interface SavingsProduct {
  id: string;
  name: string;
  type: 'FLEXIBLE' | 'FIXED_TERM';
  currency: CurrencyCode;
  apyPercent: number;
  termDays: number;
  minAmount: number;
  regulatoryNote: string;
}

export interface SavingsPosition {
  id: string;
  userId: string;
  accountId: string;
  productId: string;
  productName: string;
  currency: CurrencyCode;
  principal: number;
  accruedInterest: number;
  apyPercent: number;
  maturityDate: string | null;
  status: 'ACTIVE' | 'MATURED' | 'CLOSED';
  createdAt: string;
}

export interface LoanRecord {
  id: string;
  userId: string;
  accountId: string;
  productType: 'PERSONAL_LOAN' | 'BUSINESS_LOAN' | 'CREDIT_LINE';
  principalAmount: number;
  outstandingBalance: number;
  aprPercent: number;
  termMonths: number;
  monthlyInstallment: number;
  currency: CurrencyCode;
  status: 'UNDER_REVIEW' | 'APPROVED_SANDBOX' | 'REPAID' | 'REJECTED';
  nextDueDate: string;
  fundingSource: string;
  createdAt: string;
}

export interface BusinessEntity {
  id: string;
  ownerUserId: string;
  companyName: string;
  registrationNumber: string;
  taxId: string;
  country: string;
  kybStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  createdAt: string;
}

export interface BusinessMember {
  id: string;
  businessId: string;
  userId: string;
  fullName: string;
  email: string;
  roleTitle: string;
  permissions: string[];
  approvalLimit: number;
  status: 'ACTIVE' | 'SUSPENDED';
}

export interface BusinessInvoice {
  id: string;
  businessId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  amount: number;
  currency: CurrencyCode;
  dueDate: string;
  status: 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE';
  createdAt: string;
}

export interface MerchantRecord {
  id: string;
  userId: string;
  businessName: string;
  mcc: string;
  country: string;
  settlementCurrency: CurrencyCode;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'RESTRICTED';
  acquirerStatus: string;
  volume30d: number;
}

export interface PosTerminal {
  id: string;
  merchantId: string;
  ownerUserId?: string | null;
  ownerName?: string | null;
  serialNumber: string;
  model: string;
  locationName: string;
  status: 'ONLINE_SANDBOX' | 'OFFLINE' | 'MAINTENANCE';
  terminalMode?: 'ONLINE' | 'OFFLINE' | 'HYBRID';
  approvalStatus?: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  onlineEnabled?: boolean;
  offlineEnabled?: boolean;
  offlineFloorLimit?: number;
  offlineQueuedCount?: number;
  offlineQueuedAmount?: number;
  approvedBy?: string | null;
  approvedAt?: string | null;
  supportsContactless: boolean;
  supportsQr: boolean;
  supportsOfflineRules: boolean;
  lastHeartbeat: string;
}

export interface PaymentLink {
  id: string;
  merchantId: string;
  title: string;
  amount: number;
  currency: CurrencyCode;
  status: 'ACTIVE' | 'PAID' | 'EXPIRED';
  requires3ds: boolean;
  checkoutCode: string;
  createdAt: string;
}

export interface AtmMachine {
  id: string;
  code: string;
  location: string;
  city: string;
  country: string;
  status: 'OPERATIONAL_SANDBOX' | 'MAINTENANCE' | 'LOW_CASH';
  dailyLimit: number;
  feePercent: number;
  supportedSchemes: CardScheme[];
  lastDiagnostic: string;
}

export interface MembershipPlan {
  tier: MembershipTier;
  monthlyPriceEur: number;
  dailyTransferLimitEur: number;
  fxMonthlyFreeAllowanceEur: number;
  fxMarkupBps: number;
  cardTierLabel: string;
  supportSla: string;
  features: string[];
}

export interface KycKybRecord {
  id: string;
  userId: string;
  subjectName: string;
  recordType: 'KYC' | 'KYB';
  documentType: string;
  documentLast4: string;
  pepCheck: 'CLEAR' | 'REVIEW';
  sanctionsCheck: 'CLEAR' | 'REVIEW';
  riskScore: number;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  reviewedBy?: string | null;
  createdAt: string;
}

export interface AmlFraudCase {
  id: string;
  userId: string;
  transactionId?: string | null;
  caseType: 'AML' | 'FRAUD';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskScore: number;
  reason: string;
  status: 'OPEN' | 'INVESTIGATING' | 'CLEARED' | 'ESCALATED';
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  subject: string;
  category: string;
  channel?: 'TICKET' | 'LIVE_CHAT' | 'UNLOCK_REQUEST';
  priority: 'NORMAL' | 'HIGH' | 'URGENT';
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  userName?: string;
  userEmail?: string;
  userCustomerNumber?: string;
  userIsLocked?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  message: string;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  body: string;
  severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'ALERT';
  isRead: boolean;
  createdAt: string;
}

export interface ProviderIntegration {
  id: string;
  name: string;
  category: 'BANKING_RAIL' | 'CARD_ISSUER' | 'ACQUIRING_POS' | 'FX_FEED' | 'KYC_AML' | 'OPEN_BANKING';
  environment: 'SANDBOX' | 'PRODUCTION';
  status: ReadinessStatus;
  details: string;
  lastChecked: string;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: string;
  createdAt: string;
}

export interface DualApprovalRequest {
  id: string;
  requestedByUserId: string;
  requestedByEmail: string;
  actionType: string;
  payloadJson: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedByUserId?: string | null;
  createdAt: string;
}

export interface ApiKeyRecord {
  id: string;
  userId: string;
  label: string;
  keyPrefix: string;
  environment: 'SANDBOX' | 'PRODUCTION';
  scopes: string[];
  status: 'ACTIVE' | 'REVOKED';
  createdAt: string;
}

export interface WebhookRecord {
  id: string;
  userId: string;
  url: string;
  events: string[];
  status: 'ACTIVE' | 'PAUSED';
  lastDeliveryStatus: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  deviceLabel: string;
  ipAddress: string;
  createdAt: string;
  lastActiveAt: string;
  isCurrent?: boolean;
}
