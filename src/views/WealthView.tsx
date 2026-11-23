import React, { useState } from 'react';
import { Landmark, PiggyBank, Plus } from 'lucide-react';
import {
  ErrorBanner,
  ModalSheet,
  PrimaryButton,
  SandboxNotice,
  SecondaryButton,
  SemanticStateLabel,
  SurfaceCard,
  formatMoney,
} from '../components/ui.tsx';
import { useBanking } from '../context/BankingContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';

export const WealthView: React.FC<{ initialTab?: 'savings' | 'loans' }> = ({ initialTab = 'savings' }) => {
  const { data, hideBalances, apiFetch, refreshData, showToast } = useBanking();
  const { t } = useLanguage();
  const [tab, setTab] = useState<'savings' | 'loans'>(initialTab);
  const [openVaultModal, setOpenVaultModal] = useState(false);
  const [selectedProdId, setSelectedProdId] = useState('');
  const [fromAccId, setFromAccId] = useState('');
  const [savAmount, setSavAmount] = useState('1000');

  const [loanType, setLoanType] = useState<'PERSONAL_LOAN' | 'BUSINESS_LOAN' | 'CREDIT_LINE'>('PERSONAL_LOAN');
  const [loanAmount, setLoanAmount] = useState('5000');
  const [loanTerm, setLoanTerm] = useState('12');
  const [income, setIncome] = useState('4500');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const accounts = data?.accounts || [];
  const savingsProducts = data?.savingsProducts || [];
  const savingsPositions = data?.savingsPositions || [];
  const loans = data?.loans || [];

  const handleOpenSavings = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      await apiFetch('/api/savings/open', {
        method: 'POST',
        body: JSON.stringify({
          productId: selectedProdId || savingsProducts[0]?.id,
          fromAccountId: fromAccId || accounts[0]?.id,
          amount: Number(savAmount),
        }),
      });
      await refreshData();
      setOpenVaultModal(false);
      showToast('Savings vault funded (Sandbox)', 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleApplyLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      await apiFetch('/api/loans/apply', {
        method: 'POST',
        body: JSON.stringify({
          accountId: accounts[0]?.id,
          productType: loanType,
          amount: Number(loanAmount),
          termMonths: Number(loanTerm),
          monthlyIncome: Number(income),
        }),
      });
      await refreshData();
      showToast('Loan application queued for credit review', 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">{t('wealth.title')}</h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{t('common.sandboxShort')}</p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#18181D] border border-slate-200 dark:border-white/10">
          <button
            type="button"
            onClick={() => setTab('savings')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'savings' ? 'bg-white dark:bg-[#09090B] text-[#EA580C] shadow-sm' : 'text-slate-600'
            }`}
          >
            {t('wealth.savingsTab')}
          </button>
          <button
            type="button"
            onClick={() => setTab('loans')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'loans' ? 'bg-white dark:bg-[#09090B] text-[#EA580C] shadow-sm' : 'text-slate-600'
            }`}
          >
            {t('wealth.loansTab')}
          </button>
        </div>
      </div>

      <SandboxNotice message={t('common.sandboxShort')} />

      <ErrorBanner message={err} onDismiss={() => setErr(null)} />

      {tab === 'savings' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 space-y-4">
            <h2 className="text-sm font-display font-bold">Available Deposit Products</h2>
            {savingsProducts.map((p) => (
              <SurfaceCard key={p.id} className="p-5 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <PiggyBank className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C]" />
                    <span className="text-sm font-semibold">{p.name}</span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {p.type} · {p.termDays === 0 ? 'Instant Access' : `${p.termDays} Days Term`} · Min{' '}
                    {formatMoney(p.minAmount, p.currency)}
                  </div>
                  <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">{p.regulatoryNote}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xl font-display font-bold font-mono-num text-emerald-600 dark:text-emerald-400">
                    {p.apyPercent.toFixed(2)}%
                  </div>
                  <SecondaryButton
                    onClick={() => {
                      setSelectedProdId(p.id);
                      const matchingAcc = accounts.find((a) => a.currency === p.currency);
                      setFromAccId(matchingAcc?.id || accounts[0]?.id || '');
                      setSavAmount(String(p.minAmount));
                      setOpenVaultModal(true);
                    }}
                    className="!min-h-[36px] !py-1.5 !px-3 text-xs mt-2"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('ui.openVault')}</span>
                  </SecondaryButton>
                </div>
              </SurfaceCard>
            ))}
          </div>

          <div className="lg:col-span-6 space-y-4">
            <h2 className="text-sm font-display font-bold">{t('wealth.savingsTab')}</h2>
            {savingsPositions.map((pos) => (
              <SurfaceCard key={pos.id} className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{pos.productName}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      APY {pos.apyPercent}% · {pos.maturityDate || 'Flexible'}
                    </div>
                  </div>
                  <SemanticStateLabel state={pos.status} />
                </div>
                <div className="flex items-end justify-between pt-2 border-t border-slate-200/70 dark:border-white/[0.06]">
                  <div>
                    <div className="text-lg font-display font-bold font-mono-num">
                      {formatMoney(pos.principal + pos.accruedInterest, pos.currency, hideBalances)}
                    </div>
                  </div>
                  {pos.status === 'ACTIVE' && (
                    <SecondaryButton
                      onClick={async () => {
                        await apiFetch(`/api/savings/${pos.id}/withdraw`, { method: 'POST' });
                        await refreshData();
                        showToast(t('ui.withdrawWallet'), 'success');
                      }}
                      className="!min-h-[38px] text-xs"
                    >
                      {t('ui.withdrawWallet')}
                    </SecondaryButton>
                  )}
                </div>
              </SurfaceCard>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <SurfaceCard className="lg:col-span-5 p-5 sm:p-6 space-y-4">
            <h2 className="text-base font-display font-bold flex items-center gap-2">
              <Landmark className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C]" />
              <span>{t('ui.applyCredit')}</span>
            </h2>
            <form onSubmit={handleApplyLoan} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Product</label>
                <select
                  value={loanType}
                  onChange={(e) => setLoanType(e.target.value as any)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                >
                  <option value="PERSONAL_LOAN">Personal Loan</option>
                  <option value="BUSINESS_LOAN">Business Working Capital Loan</option>
                  <option value="CREDIT_LINE">Revolving Credit Line</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('transfers.amount')} (EUR)</label>
                  <input
                    type="number"
                    min="500"
                    max="100000"
                    value={loanAmount}
                    onChange={(e) => setLoanAmount(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Term (Months)</label>
                  <select
                    value={loanTerm}
                    onChange={(e) => setLoanTerm(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                  >
                    {[6, 12, 24, 36, 48].map((m) => (
                      <option key={m} value={m}>
                        {m} Months
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Monthly Net Income (EUR)</label>
                <input
                  type="number"
                  min="1"
                  value={income}
                  onChange={(e) => setIncome(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
                />
              </div>
              <PrimaryButton type="submit" loading={submitting} className="w-full">
                {t('ui.applyCredit')}
              </PrimaryButton>
            </form>
          </SurfaceCard>

          <div className="lg:col-span-7 space-y-4">
            <h2 className="text-sm font-display font-bold">{t('ui.loansSchedule')}</h2>
            {loans.map((loan) => (
              <SurfaceCard key={loan.id} className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{loan.productType.replace('_', ' ')}</div>
                    <div className="text-xs text-zinc-500 mt-0.5">{loan.fundingSource}</div>
                  </div>
                  <SemanticStateLabel state={loan.status} />
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs pt-2">
                  <div>
                    <div className="text-zinc-500">Outstanding</div>
                    <div className="font-mono-num font-bold text-sm mt-0.5">
                      {formatMoney(loan.outstandingBalance, loan.currency, hideBalances)}
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-500">Installment</div>
                    <div className="font-mono-num font-bold text-sm mt-0.5">
                      {formatMoney(loan.monthlyInstallment, loan.currency, hideBalances)}
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-500">APR / Next Due</div>
                    <div className="font-mono-num font-bold text-sm mt-0.5">
                      {loan.aprPercent}% · {loan.nextDueDate}
                    </div>
                  </div>
                </div>
                {loan.outstandingBalance > 0 && loan.status === 'APPROVED_SANDBOX' && (
                  <div className="flex gap-2 pt-2 border-t border-zinc-200/70 dark:border-white/[0.06]">
                    <SecondaryButton
                      onClick={async () => {
                        await apiFetch(`/api/loans/${loan.id}/repay`, {
                          method: 'POST',
                          body: JSON.stringify({ amount: loan.monthlyInstallment }),
                        });
                        await refreshData();
                        showToast('Installment repaid to Credit Pool E', 'success');
                      }}
                      className="!min-h-[38px] text-xs"
                    >
                      {t('ui.payInstallment')}
                    </SecondaryButton>
                    <SecondaryButton
                      onClick={async () => {
                        await apiFetch(`/api/loans/${loan.id}/repay`, {
                          method: 'POST',
                          body: JSON.stringify({ amount: loan.outstandingBalance }),
                        });
                        await refreshData();
                        showToast(t('ui.earlyRepay'), 'success');
                      }}
                      className="!min-h-[38px] text-xs"
                    >
                      {t('ui.earlyRepay')}
                    </SecondaryButton>
                  </div>
                )}
              </SurfaceCard>
            ))}
          </div>
        </div>
      )}

      <ModalSheet open={openVaultModal} onClose={() => setOpenVaultModal(false)} title="Fund Savings Vault">
        <form onSubmit={handleOpenSavings} className="space-y-4">
          <select
            value={fromAccId}
            onChange={(e) => setFromAccId(e.target.value)}
            className="w-full min-h-[44px] px-3 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} ({a.currency}) — {formatMoney(a.availableBalance, a.currency)}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            step="0.01"
            value={savAmount}
            onChange={(e) => setSavAmount(e.target.value)}
            className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
          />
          <PrimaryButton type="submit" loading={submitting} className="w-full">
            Confirm Savings Deposit
          </PrimaryButton>
        </form>
      </ModalSheet>
    </div>
  );
};
