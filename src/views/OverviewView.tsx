import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowUpRight,
  Bot,
  Check,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  HelpCircle,
  Lock,
  Plus,
  Send,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import type { NavRoute } from '../components/AppShell.tsx';
import {
  BankCardVisual,
  EmptyState,
  ErrorBanner,
  ModalSheet,
  PrimaryButton,
  SandboxNotice,
  SecondaryButton,
  SemanticStateLabel,
  SurfaceCard,
  TransactionItem,
  formatMoney,
} from '../components/ui.tsx';
import { useBanking } from '../context/BankingContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import type { TransactionRecord } from '../shared/types.ts';

interface OverviewViewProps {
  onNavigate: (route: NavRoute) => void;
  searchQuery: string;
}

const EUR_EQUIV: Record<string, number> = {
  EUR: 1,
  USD: 0.922,
  GBP: 1.171,
  CHF: 1.062,
  TRY: 0.0267,
  SAR: 0.246,
  AED: 0.251,
};

export const OverviewView: React.FC<OverviewViewProps> = ({ onNavigate, searchQuery }) => {
  const { data, hideBalances, toggleHideBalances, apiFetch, refreshData, showToast } = useBanking();
  const { t } = useLanguage();
  const [copiedIban, setCopiedIban] = useState(false);
  const [addMoneyOpen, setAddMoneyOpen] = useState(false);
  const [depositAccountId, setDepositAccountId] = useState('');
  const [depositAmount, setDepositAmount] = useState('6000');
  const [depositSource, setDepositSource] = useState('Sandbox Clearing Top-Up');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<TransactionRecord | null>(null);

  const accounts = data?.accounts || [];
  const mainAccount = accounts[0];
  const cards = data?.cards || [];
  const transactions = data?.transactions || [];
  const pendingTransactions = transactions.filter((tx) => tx.status === 'PENDING' || tx.status === 'FLAGGED');

  const consolidatedEur = useMemo(() => {
    return accounts.reduce((sum, acc) => sum + acc.availableBalance * (EUR_EQUIV[acc.currency] || 1), 0);
  }, [accounts]);

  const filteredTx = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = q
      ? transactions.filter(
          (tx) =>
            tx.counterpartyName.toLowerCase().includes(q) ||
            tx.category.toLowerCase().includes(q) ||
            tx.reference.toLowerCase().includes(q)
        )
      : transactions;
    return list.slice(0, 8);
  }, [transactions, searchQuery]);

  const spendingByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.direction === 'OUT') {
        const eurVal = tx.amount * (EUR_EQUIV[tx.currency] || 1);
        map.set(tx.category, (map.get(tx.category) || 0) + eurVal);
      }
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 4);
  }, [transactions]);

  const totalOutEur = spendingByCategory.reduce((s, c) => s + c.value, 0) || 1;

  const copyIban = async (iban: string) => {
    await navigator.clipboard.writeText(iban);
    setCopiedIban(true);
    showToast(t('common.copied'), 'info');
    setTimeout(() => setCopiedIban(false), 2000);
  };

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      await apiFetch('/api/transactions/deposit', {
        method: 'POST',
        body: JSON.stringify({
          accountId: depositAccountId || mainAccount?.id,
          amount: Number(depositAmount),
          sourceLabel: depositSource,
        }),
      });
      await refreshData();
      showToast(t('overview.creditFunds'), 'success');
      setAddMoneyOpen(false);
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const totalInEur = useMemo(
    () =>
      transactions
        .filter((tx) => tx.direction === 'IN')
        .reduce((sum, tx) => sum + tx.amount * (EUR_EQUIV[tx.currency] || 1), 0),
    [transactions]
  );

  const totalOutSummaryEur = useMemo(
    () =>
      transactions
        .filter((tx) => tx.direction === 'OUT')
        .reduce((sum, tx) => sum + tx.amount * (EUR_EQUIV[tx.currency] || 1), 0),
    [transactions]
  );

  const donutColors = ['#F97316', '#0F172A', '#10B981', '#F59E0B'];

  return (
    <div className="space-y-6">
      {/* Greeting + Consolidated Balance Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-600 dark:text-zinc-400">
            {t('overview.welcome')}, {data?.user.fullName} · #{data?.user.customerNumber} · {data?.user.membershipTier}
          </p>
          <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-slate-900 dark:text-white mt-0.5">
            {t('overview.title')}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <SecondaryButton onClick={() => onNavigate('analytics')}>
            <Bot className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C]" />
            <span>{t('overview.aiAssistant')}</span>
          </SecondaryButton>
          <PrimaryButton
            onClick={() => {
              setDepositAccountId(mainAccount?.id || '');
              setAddMoneyOpen(true);
            }}
          >
            <Plus className="w-4 h-4" />
            <span>{t('overview.addMoney')}</span>
          </PrimaryButton>
        </div>
      </div>

      <SandboxNotice message={t('common.sandboxShort')} />

      {/* Main 12-Column Responsive Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 8 Columns: Balance, Actions, Wallets, Transactions */}
        <div className="lg:col-span-8 space-y-6 min-w-0">
          {/* Dominant Hero Balance Card */}
          <SurfaceCard className="p-5 sm:p-6 bg-white dark:bg-[#111115]">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-zinc-400">
                  <span>{t('overview.totalLiquidity')}</span>
                  <button
                    type="button"
                    onClick={toggleHideBalances}
                    className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-white/10 text-slate-600 dark:text-zinc-300"
                    aria-label="Toggle balance visibility"
                  >
                    {hideBalances ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="text-3xl sm:text-4xl font-display font-bold font-mono-num tracking-tight mt-1.5 text-slate-900 dark:text-white">
                  {formatMoney(consolidatedEur, 'EUR', hideBalances)}
                </div>
                {mainAccount && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-zinc-300">
                    <span className="font-medium text-slate-500 dark:text-zinc-400">{t('overview.primaryIban')}:</span>
                    <span className="font-mono-num font-semibold text-slate-900 dark:text-white">{mainAccount.iban}</span>
                    <button
                      type="button"
                      onClick={() => copyIban(mainAccount.iban)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold text-[#EA580C] hover:bg-orange-50 dark:hover:bg-orange-500/10 dark:text-orange-300 transition-colors"
                    >
                      {copiedIban ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedIban ? t('common.copied') : t('common.copy')}</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="flex sm:flex-col sm:items-end justify-between gap-2 text-left sm:text-right pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-white/[0.06]">
                <div>
                  <div className="text-[11px] font-medium text-slate-500 dark:text-zinc-400">{t('overview.securityPosture')}</div>
                  <div className="mt-0.5 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                    <ShieldCheck className="w-4 h-4" />
                    <span>KYC {data?.user.kycStatus}</span>
                  </div>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-zinc-400">
                  {data?.user.mfaEnabled ? t('overview.mfaActive') : t('overview.mfaRec')}
                </div>
              </div>
            </div>

            {/* Live Cash-Flow & Portfolio Strip */}
            <div className="grid grid-cols-3 gap-4 mt-5 pt-4 border-t border-slate-100 dark:border-white/[0.08] text-xs">
              <div>
                <div className="text-slate-500 dark:text-zinc-400">{t('analytics.inflows')}</div>
                <div className="font-mono-num font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                  +{formatMoney(totalInEur, 'EUR', hideBalances)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-zinc-400">{t('analytics.outflows')}</div>
                <div className="font-mono-num font-bold text-slate-900 dark:text-white mt-0.5">
                  -{formatMoney(totalOutSummaryEur, 'EUR', hideBalances)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-zinc-400">{t('nav.accounts')}</div>
                <div className="font-mono-num font-bold text-slate-900 dark:text-white mt-0.5">
                  {accounts.length} {t('ui.filterActive')}
                </div>
              </div>
            </div>

            {/* Integrated Executive Quick Action Strip */}
            <div className="grid grid-cols-4 divide-x divide-slate-100 dark:divide-white/[0.08] mt-5 pt-4 border-t border-slate-100 dark:border-white/[0.08]">
              {[
                { label: t('overview.send'), icon: Send, action: () => onNavigate('transfers') },
                {
                  label: t('overview.addMoney'),
                  icon: Plus,
                  action: () => {
                    setDepositAccountId(mainAccount?.id || '');
                    setAddMoneyOpen(true);
                  },
                },
                { label: t('overview.exchange'), icon: ArrowLeftRight, action: () => onNavigate('exchange') },
                { label: t('overview.cards'), icon: CreditCard, action: () => onNavigate('cards') },
              ].map((btn) => {
                const Icon = btn.icon;
                return (
                  <button
                    key={btn.label}
                    type="button"
                    onClick={btn.action}
                    className="flex flex-col items-center justify-center gap-1.5 py-2.5 px-2 hover:bg-orange-50/70 dark:hover:bg-white/[0.04] active:scale-[0.98] transition-colors first:rounded-l-xl last:rounded-r-xl min-h-[60px]"
                  >
                    <Icon className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C]" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-zinc-100 whitespace-nowrap truncate max-w-full">
                      {btn.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </SurfaceCard>

          {/* Multi-Currency Accounts Strip */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white">{t('overview.wallets')}</h2>
              <button
                type="button"
                onClick={() => onNavigate('accounts')}
                className="text-xs font-semibold text-[#EA580C] dark:text-[#FB923C] hover:underline"
              >
                {t('overview.manageAll')} ({accounts.length})
              </button>
            </div>
            <div className="flex md:grid md:grid-cols-3 gap-3 overflow-x-auto pb-1">
              {accounts.slice(0, 6).map((acc) => (
                <SurfaceCard
                  key={acc.id}
                  onClick={() => onNavigate('accounts')}
                  className="min-w-[215px] md:min-w-0 p-4 shrink-0"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold font-mono-num text-[#EA580C] dark:text-[#FB923C]">
                      {acc.currency}
                    </span>
                    <span className="font-medium text-slate-400 dark:text-zinc-500">{acc.type}</span>
                  </div>
                  <div className="text-xl font-display font-bold font-mono-num text-slate-900 dark:text-white mt-2">
                    {formatMoney(acc.availableBalance, acc.currency, hideBalances)}
                  </div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-zinc-300 truncate mt-1">{acc.label}</div>
                  <div className="text-[11px] font-mono-num text-slate-400 dark:text-zinc-500 truncate mt-0.5">
                    {acc.accountNumber}
                  </div>
                </SurfaceCard>
              ))}
            </div>
          </div>

          {/* Pending / Flagged Operations Banner */}
          {pendingTransactions.length > 0 && (
            <SurfaceCard className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-display font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  {t('overview.pendingQueue')} ({pendingTransactions.length})
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigate('transfers')}
                  className="text-xs font-medium text-slate-600 hover:underline"
                >
                  {t('overview.details')}
                </button>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {pendingTransactions.map((tx) => (
                  <TransactionItem key={tx.id} tx={tx} hideBalance={hideBalances} onSelect={setSelectedTx} />
                ))}
              </div>
            </SurfaceCard>
          )}

          {/* Recent Transactions */}
          <SurfaceCard className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white">{t('overview.recentActivity')}</h2>
                <p className="text-xs text-slate-600 dark:text-zinc-400">{t('overview.ledgerSubtitle')}</p>
              </div>
              <SecondaryButton onClick={() => onNavigate('accounts')} className="!min-h-[36px] !py-1.5 !px-3 text-xs">
                {t('overview.allStatements')}
              </SecondaryButton>
            </div>
            {filteredTx.length ? (
              <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {filteredTx.map((tx) => (
                  <TransactionItem key={tx.id} tx={tx} hideBalance={hideBalances} onSelect={setSelectedTx} />
                ))}
              </div>
            ) : (
              <EmptyState
                title={t('overview.noTx')}
                description={t('overview.noTxDesc')}
                actionLabel={t('overview.addMoney')}
                onAction={() => setAddMoneyOpen(true)}
              />
            )}
          </SurfaceCard>
        </div>

        {/* Right 4 Columns */}
        <div className="lg:col-span-4 space-y-6 min-w-0">
          <SurfaceCard className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white">{t('overview.yourCards')}</h2>
              <button
                type="button"
                onClick={() => onNavigate('cards')}
                className="text-xs font-semibold text-[#EA580C] dark:text-[#FB923C] hover:underline"
              >
                {t('overview.manage')} ({cards.length})
              </button>
            </div>
            {cards[0] ? (
              <div className="space-y-3">
                <BankCardVisual card={cards[0]} onClick={() => onNavigate('cards')} />
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-zinc-400">
                  <span>{t('overview.dailySpendLimit')}</span>
                  <span className="font-mono-num font-bold text-slate-900 dark:text-zinc-100">
                    {formatMoney(cards[0].spentToday, 'EUR', hideBalances)} / {formatMoney(cards[0].dailyLimit, 'EUR', hideBalances)}
                  </span>
                </div>
              </div>
            ) : (
              <EmptyState
                title={t('overview.noCards')}
                description={t('cards.subtitle')}
                actionLabel={t('overview.issueCard')}
                onAction={() => onNavigate('cards')}
              />
            )}
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white">{t('overview.spendingAnalysis')}</h2>
              <button
                type="button"
                onClick={() => onNavigate('analytics')}
                className="text-xs font-semibold text-[#EA580C] dark:text-[#FB923C] hover:underline"
              >
                {t('overview.insights')}
              </button>
            </div>
            <div className="flex items-center gap-4">
              <svg viewBox="0 0 100 100" className="w-24 h-24 shrink-0 -rotate-90">
                <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeWidth="12" className="text-slate-100 dark:text-white/10" />
                {spendingByCategory.map((cat, idx) => {
                  const circumference = 2 * Math.PI * 38;
                  const pct = cat.value / totalOutEur;
                  const offset = spendingByCategory
                    .slice(0, idx)
                    .reduce((s, c) => s + (c.value / totalOutEur) * circumference, 0);
                  return (
                    <circle
                      key={cat.name}
                      cx="50"
                      cy="50"
                      r="38"
                      fill="none"
                      stroke={donutColors[idx % donutColors.length]}
                      strokeWidth="12"
                      strokeDasharray={`${pct * circumference} ${circumference}`}
                      strokeDashoffset={-offset}
                    />
                  );
                })}
              </svg>
              <div className="flex-1 space-y-2 min-w-0">
                {spendingByCategory.length ? (
                  spendingByCategory.map((cat, idx) => (
                    <div key={cat.name} className="flex items-center justify-between text-xs gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: donutColors[idx % donutColors.length] }} />
                        <span className="truncate text-slate-700 dark:text-zinc-300 font-medium">{cat.name}</span>
                      </div>
                      <span className="font-mono-num font-bold text-slate-900 dark:text-white shrink-0">
                        {formatMoney(cat.value, 'EUR', hideBalances)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500">{t('overview.noSpend')}</p>
                )}
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-5 space-y-3">
            <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white">{t('overview.shortcuts')}</h2>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { label: t('overview.receiveIban'), icon: Wallet, route: 'accounts' as NavRoute },
                { label: t('overview.vaults'), icon: ArrowUpRight, route: 'savings' as NavRoute },
                { label: t('overview.securityKyc'), icon: Lock, route: 'security' as NavRoute },
                { label: t('overview.support247'), icon: HelpCircle, route: 'support' as NavRoute },
              ].map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => onNavigate(s.route)}
                    className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-slate-50/60 dark:bg-transparent hover:border-orange-300 hover:bg-orange-50/50 text-xs font-semibold text-slate-800 dark:text-zinc-200 text-left transition-colors min-h-[44px]"
                  >
                    <Icon className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C] shrink-0" />
                    <span className="truncate">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </SurfaceCard>
        </div>
      </div>

      {/* Add Money (Sandbox Deposit) Modal */}
      <ModalSheet
        open={addMoneyOpen}
        onClose={() => setAddMoneyOpen(false)}
        title={t('overview.depositTitle')}
        subtitle={t('overview.depositSub')}
      >
        <SandboxNotice message={t('common.sandboxShort')} />
        <ErrorBanner message={err} onDismiss={() => setErr(null)} />
        <form onSubmit={handleDeposit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
              {t('overview.destAccount')}
            </label>
            <select
              value={depositAccountId || mainAccount?.id || ''}
              onChange={(e) => setDepositAccountId(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({a.currency}) — {formatMoney(a.availableBalance, a.currency)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
              {t('overview.amount')}
            </label>
            <input
              type="number"
              step="0.01"
              min="1"
              max="1000000"
              required
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-xl font-bold font-mono-num"
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {[500, 1000, 6000, 10000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDepositAmount(String(preset))}
                  className={`px-3 py-1 rounded-lg text-xs font-mono-num font-bold border ${
                    Number(depositAmount) === preset
                      ? 'bg-[#F97316] text-white border-[#F97316]'
                      : 'bg-white dark:bg-[#18181D] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-white/10'
                  }`}
                >
                  {preset.toLocaleString()}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
              {t('overview.fundingMethod')}
            </label>
            <select
              value={depositSource}
              onChange={(e) => setDepositSource(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
            >
              <option value="Sandbox Clearing Top-Up">Sandbox Bank Clearing Top-Up</option>
              <option value="Test Debit Card Top-Up">Test Debit Card Top-Up</option>
              <option value="Sandbox Payroll Credit">Sandbox Payroll Credit</option>
            </select>
          </div>
          <PrimaryButton type="submit" loading={submitting} className="w-full">
            {t('overview.creditFunds')}
          </PrimaryButton>
        </form>
      </ModalSheet>

      {/* Transaction Detail Receipt Modal */}
      <ModalSheet
        open={Boolean(selectedTx)}
        onClose={() => setSelectedTx(null)}
        title={t('overview.txReceipt')}
        subtitle={selectedTx?.reference}
      >
        {selectedTx && (
          <div className="space-y-4">
            <div className="text-center py-3 border-b border-slate-200 dark:border-white/10">
              <div className="text-xs text-slate-600 dark:text-zinc-400">{selectedTx.counterpartyName}</div>
              <div className="text-3xl font-display font-bold font-mono-num text-slate-900 dark:text-white mt-1">
                {selectedTx.direction === 'IN' ? '+' : '-'}
                {formatMoney(selectedTx.amount, selectedTx.currency, hideBalances)}
              </div>
              <div className="mt-2 flex justify-center">
                <SemanticStateLabel state={selectedTx.status} />
              </div>
            </div>
            <dl className="space-y-2.5 text-xs">
              {[
                ['ID', selectedTx.id],
                ['Type', selectedTx.type],
                ['IBAN', selectedTx.counterpartyIban || 'Internal'],
                [t('ui.fee'), formatMoney(selectedTx.fee, selectedTx.currency)],
                ['Auth', selectedTx.authorizationCode],
                ['Source', selectedTx.source],
                ['Date', new Date(selectedTx.createdAt).toLocaleString()],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-zinc-400">{k}</dt>
                  <dd className="font-mono-num font-semibold text-slate-900 dark:text-zinc-100 text-right break-all">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </ModalSheet>
    </div>
  );
};
