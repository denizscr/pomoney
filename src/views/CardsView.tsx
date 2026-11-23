import React, { useMemo, useState } from 'react';
import {
  CreditCard,
  Globe,
  KeyRound,
  Landmark,
  Lock,
  Plus,
  ShieldCheck,
  Snowflake,
  Truck,
  Unlock,
  Wifi,
} from 'lucide-react';
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
  formatMoney,
} from '../components/ui.tsx';
import { useBanking } from '../context/BankingContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import type { BankCard, CardProductType, CardScheme } from '../shared/types.ts';

type CardFilter = 'ALL' | 'ACTIVE' | 'VIRTUAL' | 'PHYSICAL' | 'FROZEN';

export const CardsView: React.FC = () => {
  const { data, hideBalances, apiFetch, refreshData, showToast } = useBanking();
  const { t } = useLanguage();
  const cards = data?.cards || [];
  const accounts = data?.accounts || [];
  const atms = data?.atms || [];

  const [filter, setFilter] = useState<CardFilter>('ALL');
  const [selectedId, setSelectedId] = useState<string>('');

  const filteredCards = useMemo(() => {
    return cards.filter((c) => {
      if (filter === 'ACTIVE') return c.status === 'ACTIVE';
      if (filter === 'FROZEN') return c.status === 'FROZEN';
      if (filter === 'VIRTUAL') return c.productType === 'VIRTUAL';
      if (filter === 'PHYSICAL') return c.productType !== 'VIRTUAL';
      return true;
    });
  }, [cards, filter]);

  const activeCard: BankCard | undefined =
    filteredCards.find((c) => c.id === selectedId) || filteredCards[0] || cards[0];
  const linkedAccount = accounts.find((a) => a.id === activeCard?.accountId);

  const [issueOpen, setIssueOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [atmOpen, setAtmOpen] = useState(false);
  const [scheme, setScheme] = useState<CardScheme>('VISA');
  const [productType, setProductType] = useState<CardProductType>('VIRTUAL');
  const [designVariant, setDesignVariant] = useState<'OBSIDIAN' | 'ROSE_METAL' | 'CHAMPAGNE_GOLD'>('ROSE_METAL');
  const [accountId, setAccountId] = useState('');
  const [newPin, setNewPin] = useState('');
  const [atmId, setAtmId] = useState('');
  const [atmAmount, setAtmAmount] = useState('200');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const totalDailyCapacity = cards
    .filter((c) => c.status === 'ACTIVE')
    .reduce((sum, c) => sum + c.dailyLimit, 0);
  const totalSpentToday = cards.reduce((sum, c) => sum + c.spentToday, 0);
  const activeCount = cards.filter((c) => c.status === 'ACTIVE').length;
  const virtualCount = cards.filter((c) => c.productType === 'VIRTUAL').length;

  const updateControl = async (patch: Record<string, unknown>, label: string) => {
    if (!activeCard) return;
    try {
      await apiFetch(`/api/cards/${activeCard.id}/controls`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await refreshData();
      showToast(label, 'success');
    } catch (error: any) {
      showToast(error.message, 'error');
    }
  };

  const handleIssueCard = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const created = await apiFetch<BankCard>('/api/cards', {
        method: 'POST',
        body: JSON.stringify({
          accountId: accountId || accounts[0]?.id,
          scheme,
          productType,
          designVariant,
        }),
      });
      await refreshData();
      setFilter('ALL');
      setSelectedId(created.id);
      setIssueOpen(false);
      showToast(`Issued ${scheme} ${productType} card (Sandbox)`, 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePinUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(newPin)) {
      setErr('PIN must be exactly 4 digits.');
      return;
    }
    await updateControl({ newPin }, 'Card PIN updated securely');
    setNewPin('');
    setPinOpen(false);
  };

  const handleAtmWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      await apiFetch('/api/atms/withdraw', {
        method: 'POST',
        body: JSON.stringify({
          atmId: atmId || atms[0]?.id,
          cardId: activeCard?.id,
          amount: Number(atmAmount),
        }),
      });
      await refreshData();
      setAtmOpen(false);
      showToast('Sandbox ATM withdrawal recorded', 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const spendPercent = activeCard
    ? Math.min(100, Math.round((activeCard.spentToday / Math.max(1, activeCard.dailyLimit)) * 100))
    : 0;

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
            {t('cards.title')}
          </h1>
          <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">
            {t('cards.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SecondaryButton
            onClick={() => {
              setAtmId(atms[0]?.id || '');
              setAtmOpen(true);
            }}
          >
            <Landmark className="w-4 h-4 text-[#EA580C]" />
            <span>{t('cards.atmNetwork')}</span>
          </SecondaryButton>
          <PrimaryButton
            onClick={() => {
              setAccountId(accounts[0]?.id || '');
              setIssueOpen(true);
            }}
          >
            <Plus className="w-4 h-4" />
            <span>{t('cards.issueCard')}</span>
          </PrimaryButton>
        </div>
      </div>

      <SandboxNotice message={t('common.sandboxShort')} />

      {/* Structured 3-Column Card Portfolio Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SurfaceCard className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-zinc-400">{t('cards.portfolio')}</div>
          <div className="text-2xl font-display font-bold font-mono-num text-slate-900 dark:text-white mt-1">
            {cards.length}
          </div>
          <div className="text-xs text-slate-600 dark:text-zinc-400 mt-1">
            {activeCount} {t('ui.filterActive')} · {virtualCount} {t('ui.filterVirtual')}
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-zinc-400">{t('cards.dailyLimit')}</div>
          <div className="text-2xl font-display font-bold font-mono-num text-slate-900 dark:text-white mt-1">
            {formatMoney(totalDailyCapacity, 'EUR', hideBalances)}
          </div>
          <div className="text-xs text-slate-600 dark:text-zinc-400 mt-1">
            {t('ui.spentToday')}: <span className="font-mono-num font-semibold">{formatMoney(totalSpentToday, 'EUR', hideBalances)}</span>
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-zinc-400">{t('cards.securityToken')}</div>
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-400 mt-2">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>3DS / Masked PAN Vault</span>
          </div>
        </SurfaceCard>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#18181D] border border-slate-200 dark:border-white/10 overflow-x-auto max-w-full">
          {(
            [
              ['ALL', `${t('ui.filterAllCards')} (${cards.length})`],
              ['ACTIVE', t('ui.filterActive')],
              ['VIRTUAL', t('ui.filterVirtual')],
              ['PHYSICAL', t('ui.filterPhysical')],
              ['FROZEN', t('ui.filterFrozen')],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                filter === id
                  ? 'bg-white dark:bg-[#09090B] text-[#EA580C] dark:text-[#FB923C] shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Organized 2-Column Master-Detail Card Manager */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Featured Visual Card + Compact Card Selector List */}
        <div className="lg:col-span-5 space-y-4">
          {activeCard ? (
            <SurfaceCard className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                  {t('ui.selectedCard')}
                </span>
                <SemanticStateLabel state={activeCard.status} />
              </div>

              <BankCardVisual card={activeCard} selected />

              <div className="pt-2 border-t border-slate-100 dark:border-white/[0.08]">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-2.5">
                  {t('ui.switchCard')} ({filteredCards.length})
                </div>
                <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                  {filteredCards.map((card) => {
                    const isSelected = card.id === activeCard.id;
                    return (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => setSelectedId(card.id)}
                        className={`w-full flex items-center justify-between gap-3 py-3 px-3 -mx-3 rounded-xl text-left transition-colors ${
                          isSelected
                            ? 'bg-orange-50/90 dark:bg-orange-500/10'
                            : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-10 h-7 rounded-md flex items-center justify-center text-[10px] font-bold font-mono-num shrink-0 ${
                              isSelected
                                ? 'bg-[#F97316] text-white'
                                : 'bg-slate-900 text-white dark:bg-white/10'
                            }`}
                          >
                            {card.scheme.slice(0, 4)}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {card.scheme} {card.productType} · •••• {card.last4}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">
                              Exp {card.expiry} · Limit {formatMoney(card.dailyLimit, 'EUR', hideBalances)}
                            </div>
                          </div>
                        </div>
                        <SemanticStateLabel state={card.status} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </SurfaceCard>
          ) : (
            <SurfaceCard className="p-6">
              <EmptyState
                title="No cards match this filter"
                description="Switch filters or issue a new Visa, Mastercard, or TROY sandbox card."
                actionLabel="Issue New Card"
                onAction={() => {
                  setAccountId(accounts[0]?.id || '');
                  setIssueOpen(true);
                }}
              />
            </SurfaceCard>
          )}
        </div>

        {/* Right Column: Structured Card Command Center */}
        <div className="lg:col-span-7 space-y-5">
          {activeCard && (
            <>
              {/* Card Controls & Quick Actions */}
              <SurfaceCard className="p-5 sm:p-6 space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-100 dark:border-white/[0.08]">
                  <div>
                    <div className="text-xs font-semibold text-[#EA580C] dark:text-[#FB923C]">
                      {activeCard.scheme} · {activeCard.productType} CARD · •••• {activeCard.last4}
                    </div>
                    <h2 className="text-xl font-display font-bold text-slate-900 dark:text-white mt-0.5">
                      {activeCard.holderName}
                    </h2>
                    {linkedAccount && (
                      <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1">
                        Linked Account: {linkedAccount.label} ({linkedAccount.currency})
                      </p>
                    )}
                  </div>
                  <SemanticStateLabel state={activeCard.status} />
                </div>

                {/* Evenly Aligned 3-Column Primary Action Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <SecondaryButton
                    onClick={() =>
                      updateControl(
                        { status: activeCard.status === 'FROZEN' ? 'ACTIVE' : 'FROZEN' },
                        activeCard.status === 'FROZEN' ? 'Card unfrozen & reactivated' : 'Card frozen immediately'
                      )
                    }
                    className={`w-full ${
                      activeCard.status === 'FROZEN'
                        ? '!border-emerald-300 !bg-emerald-50/70 !text-emerald-800 dark:!text-emerald-400'
                        : '!border-sky-300 !bg-sky-50/70 !text-sky-800 dark:!text-sky-400'
                    }`}
                  >
                    {activeCard.status === 'FROZEN' ? (
                      <>
                        <Unlock className="w-4 h-4" />
                        <span>{t('cards.unfreeze')}</span>
                      </>
                    ) : (
                      <>
                        <Snowflake className="w-4 h-4" />
                        <span>{t('cards.freeze')}</span>
                      </>
                    )}
                  </SecondaryButton>

                  <SecondaryButton onClick={() => setPinOpen(true)} className="w-full">
                    <KeyRound className="w-4 h-4 text-[#EA580C]" />
                    <span>{t('cards.changePin')}</span>
                  </SecondaryButton>

                  <SecondaryButton
                    onClick={() => {
                      if (activeCard.status !== 'CANCELLED') {
                        updateControl({ status: 'CANCELLED' }, t('cards.closeCard'));
                      }
                    }}
                    disabled={activeCard.status === 'CANCELLED'}
                    className="w-full !text-red-600 hover:!bg-red-50 hover:!border-red-200 dark:!text-red-400"
                  >
                    <Lock className="w-4 h-4" />
                    <span>{t('cards.closeCard')}</span>
                  </SecondaryButton>
                </div>

                {/* Daily Spending Limit Utilization & Presets */}
                <div className="p-4 rounded-xl bg-slate-50/90 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/[0.06] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">{t('cards.dailyLimit')}</div>
                      <div className="text-[11px] text-slate-600 dark:text-zinc-400">
                        {t('ui.spentToday')}: {formatMoney(activeCard.spentToday, 'EUR', hideBalances)} ({spendPercent}%)
                      </div>
                    </div>
                    <div className="text-base font-display font-bold font-mono-num text-[#EA580C] dark:text-[#FB923C]">
                      {formatMoney(activeCard.dailyLimit, 'EUR', hideBalances)}
                    </div>
                  </div>

                  <div className="h-2 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#F97316] transition-all"
                      style={{ width: `${Math.max(3, spendPercent)}%` }}
                    />
                  </div>

                  <input
                    type="range"
                    min={500}
                    max={50000}
                    step={500}
                    value={activeCard.dailyLimit}
                    onChange={(e) =>
                      updateControl({ dailyLimit: Number(e.target.value) }, `€${e.target.value}`)
                    }
                    className="w-full accent-[#F97316]"
                  />

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {[1000, 5000, 15000, 30000].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => updateControl({ dailyLimit: preset }, `€${preset.toLocaleString()}`)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold font-mono-num border transition-colors ${
                          activeCard.dailyLimit === preset
                            ? 'bg-[#F97316] text-white border-[#F97316]'
                            : 'bg-white dark:bg-[#18181D] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-white/10 hover:border-orange-300'
                        }`}
                      >
                        €{preset.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Channel Security Matrix */}
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                    {t('cards.channelControls')}
                  </h3>
                  <div className="divide-y divide-slate-100 dark:divide-white/[0.06] border border-slate-200/80 dark:border-white/[0.08] rounded-xl overflow-hidden bg-white dark:bg-transparent">
                    {[
                      {
                        key: 'onlineEnabled',
                        label: t('cards.onlinePay'),
                        desc: '3DS / E-Commerce',
                        icon: Globe,
                        value: activeCard.onlineEnabled,
                      },
                      {
                        key: 'contactlessEnabled',
                        label: t('cards.contactless'),
                        desc: 'NFC Tap-to-Pay',
                        icon: Wifi,
                        value: activeCard.contactlessEnabled,
                      },
                      {
                        key: 'atmEnabled',
                        label: t('cards.atmCash'),
                        desc: 'ATM Cash',
                        icon: Landmark,
                        value: activeCard.atmEnabled,
                      },
                    ].map((ctrl) => {
                      const Icon = ctrl.icon;
                      return (
                        <div
                          key={ctrl.key}
                          className="flex items-center justify-between gap-4 p-3.5 hover:bg-slate-50/70 dark:hover:bg-white/[0.02]"
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-lg bg-orange-50 dark:bg-orange-500/15 text-[#EA580C] dark:text-[#FB923C] flex items-center justify-center shrink-0">
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900 dark:text-white">{ctrl.label}</div>
                              <div className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{ctrl.desc}</div>
                            </div>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={ctrl.value}
                            onClick={() =>
                              updateControl(
                                { [ctrl.key]: !ctrl.value },
                                `${ctrl.label} ${!ctrl.value ? 'enabled' : 'disabled'}`
                              )
                            }
                            className={`w-12 h-7 rounded-full transition-colors p-1 shrink-0 ${
                              ctrl.value ? 'bg-[#F97316]' : 'bg-slate-300 dark:bg-zinc-700'
                            }`}
                          >
                            <div
                              className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                                ctrl.value ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Card Specifications & Delivery Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-slate-100 dark:border-white/[0.08] text-xs">
                  <div>
                    <div className="text-slate-500 dark:text-zinc-400">Network</div>
                    <div className="font-bold text-slate-900 dark:text-white mt-0.5">{activeCard.scheme}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-zinc-400">Format</div>
                    <div className="font-bold text-slate-900 dark:text-white mt-0.5">{activeCard.productType}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-zinc-400">{t('ui.expires')}</div>
                    <div className="font-bold font-mono-num text-slate-900 dark:text-white mt-0.5">{activeCard.expiry}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-zinc-400">Fulfillment</div>
                    <div className="inline-flex items-center gap-1 font-bold text-slate-900 dark:text-white mt-0.5">
                      <Truck className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
                      <span className="truncate">{activeCard.deliveryStatus}</span>
                    </div>
                  </div>
                </div>
              </SurfaceCard>
            </>
          )}
        </div>
      </div>

      {/* Issue New Card Modal */}
      <ModalSheet open={issueOpen} onClose={() => setIssueOpen(false)} title="Issue New PRO MONEY Card">
        <ErrorBanner message={err} onDismiss={() => setErr(null)} />
        <form onSubmit={handleIssueCard} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">Funding Account</label>
            <select
              value={accountId || accounts[0]?.id || ''}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({a.currency})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">Card Scheme</label>
              <select
                value={scheme}
                onChange={(e) => setScheme(e.target.value as CardScheme)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
              >
                <option value="VISA">Visa (Sandbox)</option>
                <option value="MASTERCARD">Mastercard (Sandbox)</option>
                <option value="TROY">TROY (Sandbox)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">Product Type</label>
              <select
                value={productType}
                onChange={(e) => setProductType(e.target.value as CardProductType)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
              >
                <option value="VIRTUAL">Virtual Card</option>
                <option value="PHYSICAL">Physical Card</option>
                <option value="DEBIT">Debit Card</option>
                <option value="PREPAID">Prepaid Card</option>
                <option value="PREMIUM">Premium Metal</option>
                <option value="BUSINESS">Business Card</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">Card Finish</label>
            <select
              value={designVariant}
              onChange={(e) => setDesignVariant(e.target.value as any)}
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
            >
              <option value="ROSE_METAL">Tangerine Orange Signature</option>
              <option value="OBSIDIAN">Slate Executive</option>
              <option value="CHAMPAGNE_GOLD">Warm Gold Edition</option>
            </select>
          </div>
          <PrimaryButton type="submit" loading={submitting} className="w-full">
            <CreditCard className="w-4 h-4" />
            <span>Issue Sandbox Card</span>
          </PrimaryButton>
        </form>
      </ModalSheet>

      {/* PIN Modal */}
      <ModalSheet open={pinOpen} onClose={() => setPinOpen(false)} title="Update Card PIN">
        <ErrorBanner message={err} onDismiss={() => setErr(null)} />
        <form onSubmit={handlePinUpdate} className="space-y-4">
          <p className="text-xs text-slate-600 dark:text-zinc-400">
            PIN is hashed server-side using salted scrypt; raw PIN values are never stored in plaintext.
          </p>
          <input
            type="password"
            maxLength={4}
            pattern="\d{4}"
            required
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            placeholder="Enter 4-digit PIN"
            className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-center text-lg font-mono-num tracking-[0.5em]"
          />
          <PrimaryButton type="submit" className="w-full">
            Save Encrypted PIN
          </PrimaryButton>
        </form>
      </ModalSheet>

      {/* ATM Management & Sandbox Withdrawal Modal */}
      <ModalSheet
        open={atmOpen}
        onClose={() => setAtmOpen(false)}
        title="PRO MONEY ATM Network"
        subtitle="Terminal status, limits, fees & sandbox cash withdrawal"
      >
        <ErrorBanner message={err} onDismiss={() => setErr(null)} />
        <div className="space-y-2.5 max-h-48 overflow-y-auto">
          {atms.map((atm) => (
            <button
              key={atm.id}
              type="button"
              onClick={() => setAtmId(atm.id)}
              className={`w-full p-3 rounded-xl border text-left transition-colors ${
                (atmId || atms[0]?.id) === atm.id
                  ? 'border-[#F97316] bg-orange-50/70 dark:bg-orange-500/10'
                  : 'border-slate-200 dark:border-white/10'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold font-mono-num text-slate-900 dark:text-white">
                  {atm.code} · {atm.city}
                </span>
                <SemanticStateLabel state={atm.status} />
              </div>
              <div className="text-xs text-slate-600 dark:text-zinc-400 mt-1">{atm.location}</div>
              <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">
                Limit {atm.dailyLimit} · Fee {atm.feePercent}% · {atm.supportedSchemes.join(', ')}
              </div>
            </button>
          ))}
        </div>

        <form onSubmit={handleAtmWithdraw} className="space-y-3 pt-3 border-t border-slate-200 dark:border-white/10">
          <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300">Sandbox Withdrawal Amount</label>
          <input
            type="number"
            min="10"
            step="10"
            required
            value={atmAmount}
            onChange={(e) => setAtmAmount(e.target.value)}
            className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm font-mono-num"
          />
          <PrimaryButton type="submit" loading={submitting} className="w-full">
            Execute Sandbox ATM Withdrawal
          </PrimaryButton>
        </form>
      </ModalSheet>
    </div>
  );
};
