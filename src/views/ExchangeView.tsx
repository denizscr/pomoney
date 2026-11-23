import React, { useMemo, useState } from 'react';
import { ArrowLeftRight, RefreshCw } from 'lucide-react';
import {
  ErrorBanner,
  PrimaryButton,
  SandboxNotice,
  SurfaceCard,
  TransactionItem,
  formatMoney,
} from '../components/ui.tsx';
import { useBanking } from '../context/BankingContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';

export const ExchangeView: React.FC = () => {
  const { data, hideBalances, apiFetch, refreshData, showToast } = useBanking();
  const { t } = useLanguage();
  const accounts = data?.accounts || [];
  const fxRates = data?.fxRates || [];
  const fxHistory = (data?.transactions || []).filter((t) => t.type === 'FX_EXCHANGE');

  const [fromId, setFromId] = useState(accounts[0]?.id || '');
  const [toId, setToId] = useState(accounts[1]?.id || accounts[0]?.id || '');
  const [amount, setAmount] = useState('500');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fromAcc = accounts.find((a) => a.id === (fromId || accounts[0]?.id)) || accounts[0];
  const toAcc = accounts.find((a) => a.id === (toId || accounts[1]?.id)) || accounts[1] || accounts[0];

  const activePlan = data?.membershipPlans.find((p) => p.tier === data.user.membershipTier);
  const feeBps = activePlan?.fxMarkupBps ?? 50;

  const estimatedRate = useMemo(() => {
    if (!fromAcc || !toAcc || fromAcc.currency === toAcc.currency) return 1;
    const direct = fxRates.find((r) => r.base === fromAcc.currency && r.quote === toAcc.currency);
    if (direct) return direct.bid;
    const inverse = fxRates.find((r) => r.base === toAcc.currency && r.quote === fromAcc.currency);
    if (inverse) return Number((1 / inverse.ask).toFixed(4));
    const l1 = fromAcc.currency === 'EUR' ? 1 : fxRates.find((r) => r.base === 'EUR' && r.quote === fromAcc.currency)?.mid || 1;
    const l2 = toAcc.currency === 'EUR' ? 1 : fxRates.find((r) => r.base === 'EUR' && r.quote === toAcc.currency)?.mid || 1;
    return Number((l2 / l1).toFixed(4));
  }, [fromAcc, toAcc, fxRates]);

  const numericAmt = Number(amount) || 0;
  const feeAmount = Number(((numericAmt * feeBps) / 10000).toFixed(2));
  const receiveAmount = Number(((numericAmt - feeAmount) * estimatedRate).toFixed(2));

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!fromAcc || !toAcc) return;
    setLoading(true);
    try {
      await apiFetch('/api/transactions/fx', {
        method: 'POST',
        body: JSON.stringify({
          fromAccountId: fromAcc.id,
          toAccountId: toAcc.id,
          fromAmount: numericAmt,
        }),
      });
      await refreshData();
      showToast(`Converted ${numericAmt} ${fromAcc.currency} to ${toAcc.currency}`, 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold tracking-tight">{t('exchange.title')}</h1>
        <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{t('exchange.subtitle')}</p>
      </div>

      <SandboxNotice message={t('common.sandboxShort')} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <SurfaceCard className="lg:col-span-6 p-5 sm:p-6 space-y-4">
          <ErrorBanner message={err} onDismiss={() => setErr(null)} />
          <form onSubmit={handleConvert} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('exchange.sellFrom')}</label>
              <select
                value={fromAcc?.id || ''}
                onChange={(e) => setFromId(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} ({a.currency}) — {formatMoney(a.availableBalance, a.currency, hideBalances)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('exchange.amount')}</label>
              <input
                type="number"
                min="1"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-lg font-mono-num"
              />
            </div>

            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => {
                  const prevFrom = fromAcc?.id || '';
                  setFromId(toAcc?.id || '');
                  setToId(prevFrom);
                }}
                className="p-2.5 rounded-full border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10"
                aria-label="Swap currencies"
              >
                <ArrowLeftRight className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C]" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('exchange.buyInto')}</label>
              <select
                value={toAcc?.id || ''}
                onChange={(e) => setToId(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} ({a.currency}) — {formatMoney(a.availableBalance, a.currency, hideBalances)}
                  </option>
                ))}
              </select>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-white/[0.03] space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">
                  {t('exchange.rate')} ({fromAcc?.currency}/{toAcc?.currency})
                </span>
                <span className="font-mono-num font-semibold">{estimatedRate.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">
                  {data?.user.membershipTier} ({feeBps} bps)
                </span>
                <span className="font-mono-num">{formatMoney(feeAmount, fromAcc?.currency || 'EUR')}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-white/10">
                <span className="text-slate-500">{t('exchange.youReceive')}</span>
                <span className="font-mono-num font-bold text-base text-emerald-600 dark:text-emerald-400">
                  {formatMoney(receiveAmount, toAcc?.currency || 'USD')}
                </span>
              </div>
            </div>

            <PrimaryButton type="submit" loading={loading} className="w-full">
              <RefreshCw className="w-4 h-4" />
              <span>{t('exchange.executeBtn')}</span>
            </PrimaryButton>
          </form>
        </SurfaceCard>

        <div className="lg:col-span-6 space-y-6">
          <SurfaceCard className="p-5">
            <h2 className="text-sm font-display font-bold mb-3">{t('ui.refPairs')}</h2>
            <div className="divide-y divide-slate-100 dark:divide-white/[0.06] text-xs">
              {fxRates.map((r) => (
                <div key={r.pair} className="py-2.5 flex items-center justify-between gap-4">
                  <span className="font-semibold font-mono-num">{r.pair}</span>
                  <div className="flex items-center gap-4 font-mono-num">
                    <span className="text-slate-500">Bid {r.bid.toFixed(4)}</span>
                    <span className="text-slate-900 dark:text-zinc-100 font-semibold">Ask {r.ask.toFixed(4)}</span>
                  </div>
                </div>
              ))}
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <h2 className="text-sm font-display font-bold mb-3">{t('ui.fxHistory')}</h2>
            {fxHistory.length ? (
              <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {fxHistory.map((tx) => (
                  <TransactionItem key={tx.id} tx={tx} hideBalance={hideBalances} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-4 text-center">{t('accounts.noMovements')}</p>
            )}
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
};
