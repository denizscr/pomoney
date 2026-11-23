import React, { useMemo, useState } from 'react';
import { Bot, Download, Send, Sparkles } from 'lucide-react';
import {
  ErrorBanner,
  PrimaryButton,
  SecondaryButton,
  SurfaceCard,
  formatMoney,
} from '../components/ui.tsx';
import { useBanking } from '../context/BankingContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';

export const AnalyticsAiView: React.FC = () => {
  const { data, hideBalances, apiFetch, token, showToast } = useBanking();
  const { t } = useLanguage();
  const transactions = data?.transactions || [];

  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const summary = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    const categories = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.direction === 'IN') inflow += tx.amount;
      if (tx.direction === 'OUT') {
        outflow += tx.amount;
        categories.set(tx.category, (categories.get(tx.category) || 0) + tx.amount);
      }
    }
    return {
      inflow,
      outflow,
      net: inflow - outflow,
      categories: Array.from(categories.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [transactions]);

  const askAi = async (customPrompt?: string) => {
    const q = (customPrompt || prompt).trim();
    if (!q) return;
    setAiError(null);
    const nextHistory = [...messages, { role: 'user' as const, content: q }];
    setMessages(nextHistory);
    if (!customPrompt) setPrompt('');
    setAiLoading(true);
    try {
      const res = await apiFetch<{ reply: string }>('/api/ai/assistant', {
        method: 'POST',
        body: JSON.stringify({ prompt: q, history: messages }),
      });
      setMessages([...nextHistory, { role: 'assistant', content: res.reply }]);
    } catch (error: any) {
      setAiError(error.message);
    } finally {
      setAiLoading(false);
    }
  };

  const downloadStatement = async () => {
    const res = await fetch('/api/reports/statement.csv', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pro-money-analytics-statement.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Analytics CSV exported', 'success');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">{t('analytics.title')}</h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{t('analytics.subtitle')}</p>
        </div>
        <SecondaryButton onClick={downloadStatement}>
          <Download className="w-4 h-4" />
          <span>{t('ui.exportCsv')}</span>
        </SecondaryButton>
      </div>

      {/* Top Cash Flow KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SurfaceCard className="p-5">
          <div className="text-xs text-slate-500">{t('analytics.inflows')}</div>
          <div className="text-2xl font-display font-bold font-mono-num text-emerald-600 dark:text-emerald-400 mt-1">
            +{formatMoney(summary.inflow, 'EUR', hideBalances)}
          </div>
        </SurfaceCard>
        <SurfaceCard className="p-5">
          <div className="text-xs text-slate-500">{t('analytics.outflows')}</div>
          <div className="text-2xl font-display font-bold font-mono-num mt-1">
            -{formatMoney(summary.outflow, 'EUR', hideBalances)}
          </div>
        </SurfaceCard>
        <SurfaceCard className="p-5">
          <div className="text-xs text-slate-500">{t('analytics.net')}</div>
          <div className="text-2xl font-display font-bold font-mono-num text-[#EA580C] dark:text-[#FB923C] mt-1">
            {formatMoney(summary.net, 'EUR', hideBalances)}
          </div>
        </SurfaceCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Category Bar Breakdown */}
        <SurfaceCard className="lg:col-span-5 p-5 space-y-4">
          <h2 className="text-sm font-display font-bold">{t('ui.spendCategory')}</h2>
          <div className="space-y-3.5">
            {summary.categories.length ? (
              summary.categories.map(([cat, amt]) => {
                const pct = Math.min(100, Math.round((amt / (summary.outflow || 1)) * 100));
                return (
                  <div key={cat} className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium">{cat}</span>
                      <span className="font-mono-num font-semibold">
                        {formatMoney(amt, 'EUR', hideBalances)} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-100 dark:bg-white/[0.06] overflow-hidden">
                      <div className="h-full rounded-full bg-[#F97316]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-zinc-500 py-6 text-center">No spending data available yet.</p>
            )}
          </div>
        </SurfaceCard>

        {/* AI Financial Assistant */}
        <SurfaceCard className="lg:col-span-7 p-5 flex flex-col min-h-[420px]">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-zinc-200/80 dark:border-white/[0.08]">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-orange-50 dark:bg-orange-500/15 text-[#EA580C] dark:text-[#FB923C] flex items-center justify-center">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-display font-bold">PRO MONEY AI Financial Assistant</h2>
                <p className="text-[11px] text-zinc-500">
                  Strictly scoped to your authorized accounts · Never executes actions without confirmation
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 py-3">
            {[
              'Analyze my spending and suggest a budget',
              'Are there any flagged or pending transactions?',
              'Summarize my multi-currency liquidity',
            ].map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => askAi(chip)}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:border-[#F97316]/60 hover:bg-orange-50/50 text-slate-800 dark:text-zinc-200 text-left transition-colors"
              >
                {chip}
              </button>
            ))}
          </div>

          <ErrorBanner message={aiError} onDismiss={() => setAiError(null)} />

          <div className="flex-1 overflow-y-auto space-y-3 py-3 max-h-[280px]">
            {messages.length === 0 ? (
              <div className="py-10 text-center text-xs text-zinc-500 space-y-2">
                <Sparkles className="w-5 h-5 mx-auto text-[#EA580C] dark:text-[#FB923C]" />
                <p>Ask PRO MONEY AI about your cash flow, FX exposure, spending categories, or security alerts.</p>
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={`p-3.5 rounded-xl text-xs leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-[#F97316] text-white ml-8'
                      : 'bg-slate-100 dark:bg-white/[0.05] text-slate-900 dark:text-zinc-100 mr-8'
                  }`}
                >
                  {m.content}
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              askAi();
            }}
            className="flex gap-2 pt-3 border-t border-zinc-200/80 dark:border-white/[0.08]"
          >
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('analytics.askPlaceholder')}
              className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
            />
            <PrimaryButton type="submit" loading={aiLoading}>
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">{t('analytics.askBtn')}</span>
            </PrimaryButton>
          </form>
        </SurfaceCard>
      </div>
    </div>
  );
};
