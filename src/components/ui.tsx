import React, { useEffect } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Wifi,
  X,
  XCircle,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext.tsx';
import type { BankCard, CurrencyCode, TransactionRecord } from '../shared/types.ts';

export function formatMoney(amount: number, currency: CurrencyCode | string = 'EUR', hidden = false): string {
  if (hidden) return '••••••';
  const symbols: Record<string, string> = {
    EUR: '€',
    USD: '$',
    GBP: '£',
    CHF: 'CHF ',
    TRY: '₺',
    SAR: 'SAR ',
    AED: 'AED ',
  };
  const sym = symbols[currency] ?? `${currency} `;
  const formatted = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `-${sym}${formatted}` : `${sym}${formatted}`;
}

export const PrimaryButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }
> = ({ children, loading, disabled, className = '', ...props }) => (
  <button
    disabled={disabled || loading}
    className={`inline-flex items-center justify-center gap-2 min-h-[42px] px-5 py-2.5 rounded-xl text-[13px] font-semibold whitespace-nowrap shrink-0 transition-all duration-150 active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed bg-[#F97316] text-white hover:bg-[#EA580C] shadow-[0_1px_2px_rgba(234,88,12,0.28)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F97316] ${className}`}
    {...props}
  >
    {loading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
    {children}
  </button>
);

export const SecondaryButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }
> = ({ children, loading, disabled, className = '', ...props }) => (
  <button
    disabled={disabled || loading}
    className={`inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 rounded-xl text-[13px] font-medium whitespace-nowrap shrink-0 transition-all duration-150 active:scale-[0.985] disabled:opacity-50 border border-slate-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-800 dark:text-zinc-100 hover:bg-slate-50 hover:border-slate-300 dark:hover:bg-zinc-800/80 shadow-[0_1px_2px_rgba(15,23,42,0.03)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F97316] ${className}`}
    {...props}
  >
    {loading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
    {children}
  </button>
);

export const SurfaceCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}> = ({ children, className = '', onClick }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`rounded-2xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#111115] text-slate-900 dark:text-zinc-50 shadow-[0_1px_2px_rgba(15,23,42,0.03)] text-left transition-colors ${
        onClick ? 'hover:border-orange-300 dark:hover:border-orange-400/40 cursor-pointer w-full' : ''
      } ${className}`}
    >
      {children}
    </Tag>
  );
};

export const SemanticStateLabel: React.FC<{
  state: string;
  label?: string;
}> = ({ state, label }) => {
  const upper = state.toUpperCase();
  const display = label ?? state;
  if (
    [
      'COMPLETED',
      'ACTIVE',
      'VERIFIED',
      'CLEAR',
      'APPROVED',
      'APPROVED_SANDBOX',
      'ONLINE_SANDBOX',
      'OPERATIONAL_SANDBOX',
      'CONNECTED',
      'PRODUCTION ACTIVE',
      'RESOLVED',
      'PAID',
    ].includes(upper)
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>{display}</span>
      </span>
    );
  }
  if (['PENDING', 'PENDING_APPROVAL', 'UNDER_REVIEW', 'IN_PROGRESS', 'SANDBOX ONLY', 'LOW_CASH', 'OPEN', 'SENT', 'PENDING_DELIVERY'].includes(upper)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span>{display}</span>
      </span>
    );
  }
  if (['FROZEN', 'FLAGGED', 'REJECTED', 'FAILED', 'CANCELLED', 'HIGH', 'CRITICAL', 'REVERSED', 'OFFLINE', 'MAINTENANCE'].includes(upper)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5 shrink-0" />
        <span>{display}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-zinc-400 whitespace-nowrap">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span>{display}</span>
    </span>
  );
};

export const SandboxNotice: React.FC<{
  title?: string;
  message: string;
}> = ({ title, message }) => {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-200/90 dark:border-amber-500/20 bg-white dark:bg-amber-500/[0.04] px-3.5 py-2.5 text-xs text-slate-700 dark:text-amber-200">
      <ShieldAlert className="w-4 h-4 text-[#EA580C] dark:text-amber-400 shrink-0" />
      <div className="min-w-0 leading-snug truncate sm:whitespace-normal">
        <span className="font-semibold text-slate-900 dark:text-amber-100">
          {title || t('common.sandboxTitle')}
        </span>
        <span className="mx-1.5 text-slate-300 dark:text-zinc-600">·</span>
        <span className="text-slate-600 dark:text-zinc-300">{message}</span>
      </div>
    </div>
  );
};

export const TransactionItem: React.FC<{
  tx: TransactionRecord;
  hideBalance?: boolean;
  onSelect?: (tx: TransactionRecord) => void;
}> = ({ tx, hideBalance = false, onSelect }) => {
  const { t } = useLanguage();
  const isIncoming = tx.direction === 'IN';
  const isInternal = tx.direction === 'INTERNAL';

  return (
    <button
      type="button"
      onClick={() => onSelect?.(tx)}
      className="w-full flex items-center justify-between gap-3 py-3 px-2.5 -mx-2.5 rounded-xl hover:bg-slate-50/90 dark:hover:bg-white/[0.04] transition-colors text-left min-h-[56px]"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
            tx.status === 'FLAGGED'
              ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400'
              : isIncoming
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
              : isInternal
              ? 'bg-orange-50 text-[#EA580C] dark:bg-orange-500/10 dark:text-orange-400'
              : 'bg-slate-100 text-slate-700 dark:bg-white/[0.07] dark:text-zinc-200'
          }`}
        >
          {isInternal ? (
            <RefreshCw className="w-4 h-4" />
          ) : isIncoming ? (
            <ArrowDownLeft className="w-4 h-4" />
          ) : (
            <ArrowUpRight className="w-4 h-4" />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-slate-900 dark:text-zinc-100 truncate">
            {tx.counterpartyName}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-zinc-400 truncate mt-0.5">
            <span>{tx.category}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num">{new Date(tx.createdAt).toLocaleDateString()}</span>
            {tx.status !== 'COMPLETED' && (
              <>
                <span aria-hidden="true">·</span>
                <span className={tx.status === 'FLAGGED' ? 'text-red-600 font-semibold' : 'text-amber-700 font-semibold'}>
                  {tx.status}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div
          className={`text-[13px] font-bold font-mono-num ${
            isIncoming
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-slate-900 dark:text-zinc-100'
          }`}
        >
          {isIncoming ? '+' : isInternal ? '' : '-'}
          {formatMoney(tx.amount, tx.currency, hideBalance)}
        </div>
        {tx.fee > 0 && !hideBalance && (
          <div className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono-num">
            {t('ui.fee')} {formatMoney(tx.fee, tx.currency)}
          </div>
        )}
      </div>
    </button>
  );
};

export const BankCardVisual: React.FC<{
  card: BankCard;
  onClick?: () => void;
  selected?: boolean;
}> = ({ card, onClick, selected }) => {
  const { t } = useLanguage();
  const styles: Record<string, string> = {
    OBSIDIAN: 'bg-gradient-to-br from-[#1E293B] via-[#0F172A] to-[#334155] text-white border-slate-700/80',
    ROSE_METAL: 'bg-gradient-to-br from-[#EA580C] via-[#F97316] to-[#FB923C] text-white border-orange-300/40',
    CHAMPAGNE_GOLD: 'bg-gradient-to-br from-[#B45309] via-[#92400E] to-[#D97706] text-[#FFFBEB] border-amber-300/40',
    CORPORATE_SLATE: 'bg-gradient-to-br from-[#334155] via-[#1E293B] to-[#0F172A] text-white border-slate-500/40',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full aspect-[1.586/1] rounded-2xl p-5 flex flex-col justify-between text-left border shadow-md transition-all duration-150 overflow-hidden ${
        styles[card.designVariant] || styles.OBSIDIAN
      } ${selected ? 'ring-2 ring-[#F97316] ring-offset-2 ring-offset-[#F8FAFC] dark:ring-offset-[#09090B]' : 'hover:shadow-lg'}`}
    >
      {/* Subtle geometric metallic light sweep */}
      <div className="absolute -right-14 -top-14 w-48 h-48 rounded-full bg-white/[0.08] pointer-events-none" />
      <div className="absolute -left-10 -bottom-16 w-40 h-40 rounded-full bg-black/[0.12] pointer-events-none" />

      <div className="flex items-start justify-between gap-2 relative z-10">
        <div>
          <div className="text-xs font-display font-extrabold tracking-wider text-white">
            PRO <span className="text-orange-200">MONEY</span>
          </div>
          <div className="text-[11px] text-white/75 mt-0.5 tracking-wide">
            {card.productType} · SANDBOX
          </div>
        </div>
        <div className="flex items-center gap-2">
          {card.contactlessEnabled && <Wifi className="w-4 h-4 rotate-90 text-white/80" />}
          <span className="text-xs font-display font-bold tracking-widest text-amber-200">
            {card.scheme}
          </span>
        </div>
      </div>

      <div className="relative z-10 flex items-center gap-3.5 my-2">
        {/* Authentic EMV Contact Chip */}
        <div className="w-10 h-7 rounded-md bg-gradient-to-br from-amber-100 via-amber-300 to-amber-500 border border-white/40 relative overflow-hidden shrink-0">
          <div className="absolute inset-x-0 top-1/2 h-px bg-amber-900/30" />
          <div className="absolute inset-y-0 left-1/3 w-px bg-amber-900/30" />
          <div className="absolute inset-y-0 right-1/3 w-px bg-amber-900/30" />
        </div>
        <div className="font-mono-num text-base sm:text-lg tracking-[0.2em] text-white/95">
          •••• •••• •••• {card.last4}
        </div>
      </div>

      <div className="flex items-end justify-between gap-2 relative z-10">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-white/65">{t('ui.cardholder')}</div>
          <div className="text-xs font-semibold tracking-wide truncate uppercase text-white mt-0.5">{card.holderName}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-white/65">{t('ui.expires')}</div>
          <div className="text-xs font-mono-num text-white mt-0.5">{card.expiry}</div>
        </div>
      </div>

      {card.status === 'FROZEN' && (
        <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-[2px] flex flex-col items-center justify-center z-20">
          <CreditCard className="w-6 h-6 text-sky-300 mb-1.5" />
          <span className="text-xs font-semibold tracking-wider text-sky-200 uppercase">{t('ui.cardFrozen')}</span>
        </div>
      )}
    </button>
  );
};

export const ModalSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ open, onClose, title, subtitle, children }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-950/45 backdrop-blur-sm p-0 md:p-4">
      <div
        className="w-full md:max-w-lg rounded-t-3xl md:rounded-2xl bg-white dark:bg-[#111115] border-t md:border border-slate-200 dark:border-white/10 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden text-slate-900 dark:text-zinc-100"
        role="dialog"
        aria-modal="true"
      >
        <div className="md:hidden w-10 h-1.5 bg-slate-300 dark:bg-zinc-700 rounded-full mx-auto mt-3" />
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-200/80 dark:border-white/[0.08]">
          <div className="min-w-0">
            <h3 className="text-base font-display font-bold text-slate-900 dark:text-white truncate">{title}</h3>
            {subtitle && <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">{children}</div>
      </div>
    </div>
  );
};

export const EmptyState: React.FC<{
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ title, description, actionLabel, onAction }) => (
  <div className="py-10 px-4 text-center">
    <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100">{title}</p>
    <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1 max-w-sm mx-auto">{description}</p>
    {actionLabel && onAction && (
      <div className="mt-4">
        <SecondaryButton onClick={onAction}>{actionLabel}</SecondaryButton>
      </div>
    )}
  </div>
);

export const ErrorBanner: React.FC<{ message: string | null; onDismiss?: () => void }> = ({ message, onDismiss }) => {
  const { t } = useLanguage();
  if (!message) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
      <div className="flex items-center gap-2 min-w-0">
        <XCircle className="w-4 h-4 shrink-0" />
        <span className="truncate">{message}</span>
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="text-red-700 dark:text-red-400 font-semibold hover:underline shrink-0">
          {t('common.dismiss')}
        </button>
      )}
    </div>
  );
};
