import React, { useState } from 'react';
import { Copy, Download, FileText, Plus, Wallet } from 'lucide-react';
import {
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
import { buildStatementPdfBlob } from '../shared/pdfStatement.ts';
import type { AccountType, CurrencyCode } from '../shared/types.ts';

export const AccountsView: React.FC = () => {
  const { data, hideBalances, apiFetch, refreshData, showToast, token } = useBanking();
  const { t } = useLanguage();
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [exportScope, setExportScope] = useState<'selected' | 'all'>('selected');
  const [openModal, setOpenModal] = useState(false);
  const [currency, setCurrency] = useState<CurrencyCode>('TRY');
  const [type, setType] = useState<AccountType>('PERSONAL');
  const [label, setLabel] = useState('6.000 TL Günlük Hesap');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const accounts = data?.accounts || [];
  const activeAccount = accounts.find((a) => a.id === selectedAccountId) || accounts[0];
  const accountTransactions = (data?.transactions || []).filter(
    (tx) => tx.fromAccountId === activeAccount?.id || tx.toAccountId === activeAccount?.id
  );

  const handleOpenAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const created = await apiFetch<any>('/api/accounts', {
        method: 'POST',
        body: JSON.stringify({ currency, type, label }),
      });
      await refreshData();
      setSelectedAccountId(created.id);
      setOpenModal(false);
      showToast(`${label} (${currency})`, 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadCsvStatement = async () => {
    setErr(null);
    try {
      const query = exportScope === 'selected' && activeAccount ? `?accountId=${encodeURIComponent(activeAccount.id)}` : '';
      const res = await fetch(`/api/reports/statement.csv${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('CSV statement export failed.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const suffix = exportScope === 'selected' && activeAccount ? `-${activeAccount.currency.toLowerCase()}` : '-all';
      a.download = `pro-money-statement${suffix}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(t('accounts.exportCsv'), 'success');
    } catch (error: any) {
      setErr(error.message || 'CSV export failed.');
    }
  };

  const downloadPdfStatement = () => {
    setErr(null);
    const scopedTxs = exportScope === 'selected' && activeAccount ? accountTransactions : data?.transactions || [];
    const blob = buildStatementPdfBlob({
      user: data?.user,
      account: exportScope === 'selected' ? activeAccount : null,
      transactions: scopedTxs,
      scopeLabel: exportScope === 'all' ? 'All Multi-Currency Accounts' : undefined,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const suffix = exportScope === 'selected' && activeAccount ? `-${activeAccount.currency.toLowerCase()}` : '-all';
    a.download = `pro-money-statement${suffix}-${new Date().toISOString().slice(0, 10)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(t('accounts.pdfGenerated'), 'success');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">{t('accounts.title')}</h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{t('accounts.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-[#18181D] p-0.5 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setExportScope('selected')}
              className={`px-2.5 py-1.5 rounded-lg transition-colors ${
                exportScope === 'selected'
                  ? 'bg-white dark:bg-[#09090B] text-[#EA580C] dark:text-[#FB923C] shadow-sm'
                  : 'text-slate-600 dark:text-zinc-400'
              }`}
            >
              {t('accounts.exportScopeAccount')}
            </button>
            <button
              type="button"
              onClick={() => setExportScope('all')}
              className={`px-2.5 py-1.5 rounded-lg transition-colors ${
                exportScope === 'all'
                  ? 'bg-white dark:bg-[#09090B] text-[#EA580C] dark:text-[#FB923C] shadow-sm'
                  : 'text-slate-600 dark:text-zinc-400'
              }`}
            >
              {t('accounts.exportScopeAll')}
            </button>
          </div>
          <SecondaryButton onClick={downloadCsvStatement}>
            <Download className="w-4 h-4" />
            <span>{t('accounts.exportCsv')}</span>
          </SecondaryButton>
          <SecondaryButton onClick={downloadPdfStatement}>
            <FileText className="w-4 h-4" />
            <span>{t('accounts.exportPdf')}</span>
          </SecondaryButton>
          <PrimaryButton onClick={() => setOpenModal(true)}>
            <Plus className="w-4 h-4" />
            <span>{t('accounts.openNew')}</span>
          </PrimaryButton>
        </div>
      </div>

      <ErrorBanner message={err} onDismiss={() => setErr(null)} />
      <SandboxNotice message={t('common.sandboxShort')} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-3">
          {accounts.map((acc) => {
            const isSelected = acc.id === activeAccount?.id;
            return (
              <SurfaceCard
                key={acc.id}
                onClick={() => setSelectedAccountId(acc.id)}
                className={`p-4 ${isSelected ? 'ring-2 ring-[#F97316]' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-orange-50 dark:bg-white/[0.06] flex items-center justify-center font-mono-num text-xs font-bold text-[#EA580C] dark:text-[#FB923C] shrink-0">
                      {acc.currency}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{acc.label}</div>
                      <div className="text-xs text-slate-500 font-mono-num truncate">{acc.iban}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold font-mono-num">
                      {formatMoney(acc.availableBalance, acc.currency, hideBalances)}
                    </div>
                    <div className="text-[11px] text-slate-400">{acc.type}</div>
                  </div>
                </div>
              </SurfaceCard>
            );
          })}
        </div>

        <div className="lg:col-span-7 space-y-6">
          {activeAccount && (
            <>
              <SurfaceCard className="p-5 sm:p-6 space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C]" />
                      <span className="text-xs font-semibold text-slate-500">{activeAccount.type}</span>
                    </div>
                    <h2 className="text-xl font-display font-bold mt-1">{activeAccount.label}</h2>
                  </div>
                  <SemanticStateLabel state={activeAccount.status} />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                  {[
                    [t('accounts.available'), activeAccount.availableBalance],
                    [t('accounts.ledger'), activeAccount.ledgerBalance],
                    [t('accounts.pending'), activeAccount.pendingAmount],
                    [t('accounts.blocked'), activeAccount.blockedAmount],
                  ].map(([k, val]) => (
                    <div key={String(k)} className="p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200/70 dark:border-white/[0.06]">
                      <div className="text-[11px] text-slate-500">{k}</div>
                      <div className="text-sm font-bold font-mono-num mt-1">
                        {formatMoney(Number(val), activeAccount.currency, hideBalances)}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2.5 pt-2 border-t border-slate-200/80 dark:border-white/[0.08] text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">{t('accounts.accountNo')}</span>
                    <span className="font-mono-num font-medium">{activeAccount.accountNumber}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">IBAN</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(activeAccount.iban);
                        showToast(t('common.copied'), 'info');
                      }}
                      className="inline-flex items-center gap-1.5 font-mono-num font-medium text-[#EA580C] dark:text-[#FB923C] hover:underline"
                    >
                      <span>{activeAccount.iban}</span>
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">BIC / SWIFT</span>
                    <span className="font-mono-num font-medium">{activeAccount.bic}</span>
                  </div>
                </div>
              </SurfaceCard>

              <SurfaceCard className="p-5">
                <h3 className="text-sm font-display font-bold mb-3">{t('accounts.movements')}</h3>
                {accountTransactions.length ? (
                  <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                    {accountTransactions.map((tx) => (
                      <TransactionItem key={tx.id} tx={tx} hideBalance={hideBalances} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 py-6 text-center">{t('accounts.noMovements')}</p>
                )}
              </SurfaceCard>
            </>
          )}
        </div>
      </div>

      <ModalSheet open={openModal} onClose={() => setOpenModal(false)} title={t('accounts.modalTitle')}>
        <ErrorBanner message={err} onDismiss={() => setErr(null)} />
        <form onSubmit={handleOpenAccount} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('accounts.accountType')}</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
            >
              <option value="PERSONAL">Personal</option>
              <option value="MULTI_CURRENCY">Multi-Currency</option>
              <option value="SAVINGS">Savings</option>
              <option value="JOINT">Joint</option>
              <option value="BUSINESS">Business</option>
              <option value="CORPORATE">Corporate</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('accounts.currency')}</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
            >
              {['TRY', 'EUR', 'USD', 'GBP', 'CHF', 'SAR', 'AED'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('accounts.label')}</label>
            <input
              type="text"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
            />
          </div>
          <PrimaryButton type="submit" loading={loading} className="w-full">
            {t('accounts.createBtn')}
          </PrimaryButton>
        </form>
      </ModalSheet>
    </div>
  );
};
