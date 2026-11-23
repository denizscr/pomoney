import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type {
  ApiKeyRecord,
  AtmMachine,
  BankAccount,
  BankCard,
  Beneficiary,
  BusinessEntity,
  BusinessInvoice,
  BusinessMember,
  FxRate,
  IdentityVerificationRecord,
  KycKybRecord,
  LoanRecord,
  MembershipPlan,
  MerchantRecord,
  NotificationItem,
  OfflinePosQueueItem,
  PaymentLink,
  PosTerminal,
  ProviderIntegration,
  SavingsPosition,
  SavingsProduct,
  SupportTicket,
  SystemOperationSettingRecord,
  TicketMessage,
  TransactionRecord,
  UserProfile,
  WebhookRecord,
} from '../shared/types.ts';

export interface TicketWithMessages extends SupportTicket {
  messages: TicketMessage[];
}

export interface BootstrapData {
  user: UserProfile;
  accounts: BankAccount[];
  cards: BankCard[];
  transactions: TransactionRecord[];
  beneficiaries: Beneficiary[];
  scheduledTransfers: Array<{
    id: string;
    from_account_id: string;
    beneficiary_name: string;
    beneficiary_iban: string;
    amount: number;
    currency: string;
    frequency: string;
    next_run_date: string;
    status: string;
  }>;
  fxRates: FxRate[];
  savingsProducts: SavingsProduct[];
  savingsPositions: SavingsPosition[];
  loans: LoanRecord[];
  atms: AtmMachine[];
  membershipPlans: MembershipPlan[];
  notifications: NotificationItem[];
  providers: ProviderIntegration[];
  kycRecords: KycKybRecord[];
  verifications: IdentityVerificationRecord[];
  business: {
    entity: BusinessEntity;
    members: BusinessMember[];
    invoices: BusinessInvoice[];
  } | null;
  merchant: {
    profile: MerchantRecord;
    terminals: PosTerminal[];
    paymentLinks: PaymentLink[];
  } | null;
  tickets: TicketWithMessages[];
  apiKeys: ApiKeyRecord[];
  webhooks: WebhookRecord[];
  operationSettings?: SystemOperationSettingRecord[];
  offlinePosQueue?: OfflinePosQueueItem[];
  isAdminUser: boolean;
}

interface BankingContextValue {
  token: string | null;
  data: BootstrapData | null;
  loading: boolean;
  error: string | null;
  realtimeConnected: boolean;
  hideBalances: boolean;
  theme: 'dark' | 'light';
  toast: { title: string; type: 'success' | 'error' | 'info' } | null;
  toggleHideBalances: () => void;
  toggleTheme: () => void;
  showToast: (title: string, type?: 'success' | 'error' | 'info') => void;
  loginWithCredentials: (
    identifier: string,
    password: string,
    options?: { loginPortal?: 'PERSONAL' | 'CORPORATE' | 'ADMIN'; companyIdentifier?: string }
  ) => Promise<void>;
  registerAccount: (payload: {
    email: string;
    password: string;
    fullName: string;
    phone: string;
    country: string;
    accountCategory: 'Personal' | 'Business' | 'Merchant';
    companyName?: string;
    taxId?: string;
    nationalIdNumber?: string;
    passportNumber?: string;
    addressLine?: string;
    city?: string;
    postalCode?: string;
  }) => Promise<{ pendingApproval: boolean; customerNumber: string; fullName: string; accountCategory: string }>;
  logout: () => Promise<void>;
  refreshData: () => Promise<void>;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
}

const BankingContext = createContext<BankingContextValue | null>(null);

const TOKEN_STORAGE_KEY = 'promoney_session_token';

export const BankingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  });
  const [data, setData] = useState<BootstrapData | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(token));
  const [error, setError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [hideBalances, setHideBalances] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  const [toast, setToast] = useState<{ title: string; type: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const showToast = useCallback((title: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ title, type });
    setTimeout(() => {
      setToast((prev) => (prev?.title === title ? null : prev));
    }, 3500);
  }, []);

  const toggleHideBalances = useCallback(() => setHideBalances((v) => !v), []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const apiFetch = useCallback(
    async <T = unknown,>(url: string, options: RequestInit = {}): Promise<T> => {
      const headers = new Headers(options.headers || {});
      if (!headers.has('Content-Type') && options.body) {
        headers.set('Content-Type', 'application/json');
      }
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      const res = await fetch(url, { ...options, headers });
      const contentType = res.headers.get('content-type') || '';
      const payload = contentType.includes('application/json') ? await res.json() : await res.text();
      if (!res.ok) {
        if (res.status === 401 && token) {
          sessionStorage.removeItem(TOKEN_STORAGE_KEY);
          setToken(null);
          setData(null);
        }
        const msg = typeof payload === 'object' && payload?.error ? payload.error : `Request failed (${res.status})`;
        throw new Error(msg);
      }
      return payload as T;
    },
    [token]
  );

  const refreshData = useCallback(async () => {
    if (!token) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch<BootstrapData>('/api/bootstrap');
      setData(res);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to synchronize PRO MONEY core data.');
    } finally {
      setLoading(false);
    }
  }, [token, apiFetch]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Real-time WebSocket + SSE Multi-Device Synchronization
  useEffect(() => {
    if (!token) {
      setRealtimeConnected(false);
      return;
    }

    let ws: WebSocket | null = null;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const triggerDebouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        refreshData();
      }, 120);
    };

    const handleSyncPayload = (payload: any) => {
      if (payload?.type === 'transaction:high_value_alert' && payload?.data) {
        const d = payload.data;
        const alertMsg = `${d.title || 'High-Value Transaction Alert'} — ${Number(d.amount || 0).toLocaleString()} ${d.currency || ''} (${d.counterpartyName || ''})`;
        showToast(alertMsg, 'info');
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification(d.title || 'PRO MONEY High-Value Alert', {
              body: d.body || alertMsg,
              icon: '/pwa-192x192.png',
            });
          } catch {
            // Ignore browser notification errors in restricted iframes
          }
        }
      } else if (payload?.type === 'security:alert' && payload?.data?.isLocked) {
        showToast('Hesap güvenlik kilidi güncellendi.', 'error');
      }
      triggerDebouncedRefresh();
    };

    const connectSseFallback = () => {
      if (disposed || es) return;
      es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
      es.addEventListener('connected', () => {
        setRealtimeConnected(true);
      });
      es.addEventListener('sync', (evt: MessageEvent) => {
        try {
          handleSyncPayload(JSON.parse(evt.data || '{}'));
        } catch {
          triggerDebouncedRefresh();
        }
      });
      es.onerror = () => {
        es?.close();
        es = null;
      };
    };

    const connectWs = () => {
      if (disposed) return;
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
        ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          setRealtimeConnected(true);
        };
        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(String(evt.data || '{}'));
            if (msg?.event === 'connected') {
              setRealtimeConnected(true);
              return;
            }
            if (msg?.event === 'sync' && msg?.payload) {
              handleSyncPayload(msg.payload);
              return;
            }
            handleSyncPayload(msg);
          } catch {
            triggerDebouncedRefresh();
          }
        };
        ws.onerror = () => {
          connectSseFallback();
        };
        ws.onclose = () => {
          ws = null;
          setRealtimeConnected(false);
          connectSseFallback();
          if (!disposed) {
            reconnectTimer = setTimeout(connectWs, 3000);
          }
        };
      } catch {
        connectSseFallback();
      }
    };

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        triggerDebouncedRefresh();
      }
    };

    connectWs();
    connectSseFallback();
    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      ws?.close();
      es?.close();
      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      setRealtimeConnected(false);
    };
  }, [token, refreshData, showToast]);

  const loginWithCredentials = async (
    identifier: string,
    password: string,
    options?: { loginPortal?: 'PERSONAL' | 'CORPORATE' | 'ADMIN'; companyIdentifier?: string }
  ) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier,
          password,
          loginPortal: options?.loginPortal,
          companyIdentifier: options?.companyIdentifier,
          deviceLabel: navigator.userAgent.slice(0, 60),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const err = new Error(json.error || 'Authentication failed.') as Error & {
          approvalStatus?: string;
          accountLocked?: boolean;
          lockedUntil?: string | null;
          lockReason?: string | null;
          remainingAttempts?: number;
          customerNumber?: string;
        };
        err.approvalStatus = json.approvalStatus;
        err.accountLocked = Boolean(json.accountLocked);
        err.lockedUntil = json.lockedUntil || null;
        err.lockReason = json.lockReason || null;
        err.remainingAttempts = json.remainingAttempts;
        err.customerNumber = json.customerNumber;
        throw err;
      }
      sessionStorage.setItem(TOKEN_STORAGE_KEY, json.token);
      setToken(json.token);
      showToast(json.user.fullName, 'success');
    } catch (err: any) {
      setLoading(false);
      setError(err.message);
      throw err;
    }
  };

  const registerAccount = async (payload: {
    email: string;
    password: string;
    fullName: string;
    phone: string;
    country: string;
    accountCategory: 'Personal' | 'Business' | 'Merchant';
    companyName?: string;
    taxId?: string;
    nationalIdNumber?: string;
    passportNumber?: string;
    addressLine?: string;
    city?: string;
    postalCode?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Registration failed.');
      setLoading(false);
      return json;
    } catch (err: any) {
      setLoading(false);
      setError(err.message);
      throw err;
    }
  };

  const logout = async () => {
    try {
      if (token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } finally {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      setToken(null);
      setData(null);
    }
  };

  return (
    <BankingContext.Provider
      value={{
        token,
        data,
        loading,
        error,
        realtimeConnected,
        hideBalances,
        theme,
        toast,
        toggleHideBalances,
        toggleTheme,
        showToast,
        loginWithCredentials,
        registerAccount,
        logout,
        refreshData,
        apiFetch,
      }}
    >
      {children}
    </BankingContext.Provider>
  );
};

export function useBanking() {
  const ctx = useContext(BankingContext);
  if (!ctx) throw new Error('useBanking must be used inside BankingProvider');
  return ctx;
}
