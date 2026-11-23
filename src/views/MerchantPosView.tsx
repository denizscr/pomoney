import React, { useState } from 'react';
import { CreditCard, Link2, Plus, QrCode, Smartphone, Store, Wifi } from 'lucide-react';
import {
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

export const MerchantPosView: React.FC = () => {
  const { data, hideBalances, apiFetch, refreshData, showToast } = useBanking();
  const { t } = useLanguage();
  const merchant = data?.merchant;

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);

  const [locName, setLocName] = useState('Nisantasi Counter 2');
  const [linkTitle, setLinkTitle] = useState('Roastery Subscription Box');
  const [linkAmt, setLinkAmt] = useState('85');
  const [posAmt, setPosAmt] = useState('340');
  const [posMethod, setPosMethod] = useState<'CONTACTLESS' | 'CHIP_PIN' | 'QR'>('CONTACTLESS');
  const [selectedTerminalId, setSelectedTerminalId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!merchant) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-display font-bold tracking-tight">{t('pos.title')}</h1>
        <SurfaceCard className="p-6">
          <EmptyState
            title={t('pos.title')}
            description={t('auth.approvalNotice')}
          />
        </SurfaceCard>
      </div>
    );
  }

  const handleAddTerminal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/merchant/terminals', {
        method: 'POST',
        body: JSON.stringify({ locationName: locName }),
      });
      await refreshData();
      setTerminalOpen(false);
      showToast('POS Terminal provisioned (Sandbox)', 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCollectPos = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<any>('/api/merchant/pos-collect', {
        method: 'POST',
        body: JSON.stringify({
          terminalId: selectedTerminalId || merchant.terminals[0]?.id,
          amount: Number(posAmt),
          method: posMethod,
        }),
      });
      await refreshData();
      setCollectOpen(false);
      showToast(`POS collected net ${res.net} ${res.currency} (1.5% MDR fee to Pool G)`, 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/merchant/payment-links', {
        method: 'POST',
        body: JSON.stringify({
          title: linkTitle,
          amount: Number(linkAmt),
          currency: merchant.profile.settlementCurrency,
        }),
      });
      await refreshData();
      setLinkOpen(false);
      showToast('3DS Payment Link created', 'success');
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
          <div className="flex items-center gap-2">
            <Store className="w-5 h-5 text-[#EA580C] dark:text-[#FB923C]" />
            <h1 className="text-2xl font-display font-bold tracking-tight">{merchant.profile.businessName}</h1>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            MCC {merchant.profile.mcc} · {merchant.profile.acquirerStatus}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton onClick={() => setLinkOpen(true)}>
            <Link2 className="w-4 h-4" />
            <span>{t('pos.paymentLink')}</span>
          </SecondaryButton>
          <SecondaryButton onClick={() => setTerminalOpen(true)}>
            <Plus className="w-4 h-4" />
            <span>{t('pos.addTerminal')}</span>
          </SecondaryButton>
          <PrimaryButton onClick={() => setCollectOpen(true)}>
            <Wifi className="w-4 h-4" />
            <span>{t('pos.collectPos')}</span>
          </PrimaryButton>
        </div>
      </div>

      <SandboxNotice message={t('common.sandboxShort')} />
      <ErrorBanner message={err} onDismiss={() => setErr(null)} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SurfaceCard className="p-5">
          <div className="text-xs text-slate-500">{t('pos.volume30d')}</div>
          <div className="text-2xl font-display font-bold font-mono-num mt-1">
            {formatMoney(merchant.profile.volume30d, merchant.profile.settlementCurrency, hideBalances)}
          </div>
        </SurfaceCard>
        <SurfaceCard className="p-5">
          <div className="text-xs text-slate-500">{t('pos.activeTerminals')}</div>
          <div className="text-2xl font-display font-bold font-mono-num mt-1">{merchant.terminals.length}</div>
        </SurfaceCard>
        <SurfaceCard className="p-5">
          <div className="text-xs text-slate-500">{t('pos.verification')}</div>
          <div className="mt-2">
            <SemanticStateLabel state={merchant.profile.verificationStatus} />
          </div>
        </SurfaceCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <SurfaceCard className="lg:col-span-6 p-5 space-y-3">
          <h2 className="text-sm font-display font-bold">Assigned POS Terminals</h2>
          {merchant.terminals.map((t) => (
            <div key={t.id} className="p-4 rounded-xl border border-zinc-200/80 dark:border-white/[0.06] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C]" />
                  <span className="text-sm font-semibold">{t.locationName}</span>
                </div>
                <SemanticStateLabel state={t.status} />
              </div>
              <div className="text-xs text-zinc-500 font-mono-num">
                SN: {t.serialNumber} · {t.model}
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1">
                <span>
                  {t.supportsContactless ? 'NFC Contactless' : ''} · {t.supportsQr ? 'QR' : ''} ·{' '}
                  {t.supportsOfflineRules ? 'Offline Cap Enabled' : 'Online Only'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTerminalId(t.id);
                    setCollectOpen(true);
                  }}
                  className="text-[#EA580C] dark:text-[#FB923C] font-semibold hover:underline"
                >
                  Run Tap Test
                </button>
              </div>
            </div>
          ))}
        </SurfaceCard>

        <SurfaceCard className="lg:col-span-6 p-5 space-y-3">
          <h2 className="text-sm font-display font-bold">Payment Gateway & Hosted 3DS Links</h2>
          {merchant.paymentLinks.map((pl) => (
            <div key={pl.id} className="p-4 rounded-xl border border-zinc-200/80 dark:border-white/[0.06] flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{pl.title}</div>
                <div className="text-xs text-zinc-500 font-mono-num mt-0.5">
                  Code: {pl.checkoutCode} · {pl.requires3ds ? '3DS/SCA Required' : 'Standard'}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-bold font-mono-num">{formatMoney(pl.amount, pl.currency)}</div>
                <SemanticStateLabel state={pl.status} />
              </div>
            </div>
          ))}
        </SurfaceCard>
      </div>

      {/* Collect POS Modal */}
      <ModalSheet open={collectOpen} onClose={() => setCollectOpen(false)} title="POS Terminal Collection (Sandbox)">
        <form onSubmit={handleCollectPos} className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'CONTACTLESS', label: 'NFC Tap', icon: Wifi },
              { id: 'CHIP_PIN', label: 'Chip & PIN', icon: CreditCard },
              { id: 'QR', label: 'QR Code', icon: QrCode },
            ].map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPosMethod(m.id as any)}
                  className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 text-xs font-semibold ${
                    posMethod === m.id ? 'border-[#F97316] bg-orange-50 text-[#EA580C] dark:bg-orange-500/15 dark:text-[#FB923C]' : 'border-slate-200 dark:border-white/10'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>
          <input
            type="number"
            min="1"
            step="0.01"
            required
            value={posAmt}
            onChange={(e) => setPosAmt(e.target.value)}
            className="w-full min-h-[48px] px-3.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-lg font-mono-num"
          />
          <PrimaryButton type="submit" loading={submitting} className="w-full">
            Authorize & Settle to Merchant Account
          </PrimaryButton>
        </form>
      </ModalSheet>

      <ModalSheet open={terminalOpen} onClose={() => setTerminalOpen(false)} title="Provision POS Terminal">
        <form onSubmit={handleAddTerminal} className="space-y-4">
          <input type="text" required placeholder="Store Counter / Location Name" value={locName} onChange={(e) => setLocName(e.target.value)} className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm" />
          <PrimaryButton type="submit" loading={submitting} className="w-full">Register Terminal</PrimaryButton>
        </form>
      </ModalSheet>

      <ModalSheet open={linkOpen} onClose={() => setLinkOpen(false)} title="Create Hosted 3DS Payment Link">
        <form onSubmit={handleCreateLink} className="space-y-4">
          <input type="text" required placeholder="Product / Order Title" value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm" />
          <input type="number" min="1" step="0.01" required placeholder="Amount" value={linkAmt} onChange={(e) => setLinkAmt(e.target.value)} className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num" />
          <PrimaryButton type="submit" loading={submitting} className="w-full">Generate Checkout Link</PrimaryButton>
        </form>
      </ModalSheet>
    </div>
  );
};
