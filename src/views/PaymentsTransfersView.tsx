import React, { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  Calendar,
  CheckCircle2,
  Plus,
  QrCode,
  Receipt,
  Send,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
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
import type { TransactionRecord } from '../shared/types.ts';

const QUICK_AMOUNTS = [100, 500, 1000, 6000, 10000];

export const PaymentsTransfersView: React.FC<{ initialTab?: 'transfer' | 'own' | 'qr' | 'bills' | 'scheduled' }> = ({
  initialTab = 'transfer',
}) => {
  const { data, hideBalances, apiFetch, refreshData, showToast } = useBanking();
  const { t } = useLanguage();

  const accounts = data?.accounts || [];
  const beneficiaries = data?.beneficiaries || [];
  const scheduled = data?.scheduledTransfers || [];
  const transactions = (data?.transactions || []).filter((tx) =>
    ['INTERNAL_TRANSFER', 'SEPA_TRANSFER', 'SEPA_INSTANT', 'SWIFT_TRANSFER', 'QR_PAYMENT', 'BILL_PAYMENT', 'FX_EXCHANGE'].includes(tx.type)
  );

  const [tab, setTab] = useState<'transfer' | 'own' | 'qr' | 'bills' | 'scheduled'>(initialTab);
  const [fromAccountId, setFromAccountId] = useState(accounts[0]?.id || '');
  const [toOwnAccountId, setToOwnAccountId] = useState(accounts[1]?.id || accounts[0]?.id || '');
  const [rail, setRail] = useState<'INTERNAL_TRANSFER' | 'SEPA_TRANSFER' | 'SEPA_INSTANT' | 'SWIFT_TRANSFER'>('INTERNAL_TRANSFER');
  const [recipientName, setRecipientName] = useState('');
  const [recipientIban, setRecipientIban] = useState('');
  const [bic, setBic] = useState('PMNYTRISXXX');
  const [amount, setAmount] = useState('500');
  const [reference, setReference] = useState('PRO MONEY Transfer');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [receiptTx, setReceiptTx] = useState<TransactionRecord | null>(null);
  const [benModal, setBenModal] = useState(false);
  const [newBenName, setNewBenName] = useState('');
  const [newBenIban, setNewBenIban] = useState('');
  const [newBenBank, setNewBenBank] = useState('PRO MONEY');

  const [schedFreq, setSchedFreq] = useState('MONTHLY');
  const [schedDate, setSchedDate] = useState('2026-12-15');

  const [qrPayload, setQrPayload] = useState('PMQR:DE44500105175407399210:120:Atelier Nova');
  const [billProvider, setBillProvider] = useState('Turkcell Fiber & Mobile');
  const [billAmount, setBillAmount] = useState('250');

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const selectedAccount = accounts.find((a) => a.id === (fromAccountId || accounts[0]?.id)) || accounts[0];
  const targetOwnAccount =
    accounts.find((a) => a.id === toOwnAccountId && a.id !== selectedAccount?.id) ||
    accounts.find((a) => a.id !== selectedAccount?.id) ||
    accounts[0];

  const fee = rail === 'SWIFT_TRANSFER' ? 12 : rail === 'SEPA_INSTANT' ? 0.5 : 0;
  const numericAmt = Math.max(0, Number(amount) || 0);
  const remainingAfter = selectedAccount ? Math.max(0, selectedAccount.availableBalance - numericAmt - fee) : 0;

  const submitTransfer = async () => {
    setErr(null);
    setSubmitting(true);
    try {
      const tx = await apiFetch<TransactionRecord>('/api/transactions/transfer', {
        method: 'POST',
        body: JSON.stringify({
          fromAccountId: selectedAccount?.id,
          recipientName,
          recipientIban,
          bic,
          rail,
          amount: numericAmt,
          reference,
        }),
      });
      await refreshData();
      setConfirmOpen(false);
      setReceiptTx(tx);
      showToast(`${formatMoney(tx.amount, tx.currency)} → ${tx.counterpartyName}`, 'success');
    } catch (error: any) {
      setErr(error.message);
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const submitOwnTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount || !targetOwnAccount || selectedAccount.id === targetOwnAccount.id) {
      setErr('Farklı iki hesap seçin / Select two distinct accounts.');
      return;
    }
    setErr(null);
    setSubmitting(true);
    try {
      if (selectedAccount.currency !== targetOwnAccount.currency) {
        const res = await apiFetch<{ transaction: TransactionRecord }>('/api/transactions/fx', {
          method: 'POST',
          body: JSON.stringify({
            fromAccountId: selectedAccount.id,
            toAccountId: targetOwnAccount.id,
            fromAmount: numericAmt,
          }),
        });
        setReceiptTx(res.transaction);
      } else {
        const tx = await apiFetch<TransactionRecord>('/api/transactions/transfer', {
          method: 'POST',
          body: JSON.stringify({
            fromAccountId: selectedAccount.id,
            recipientName: targetOwnAccount.label,
            recipientIban: targetOwnAccount.iban,
            bic: targetOwnAccount.bic,
            rail: 'INTERNAL_TRANSFER',
            amount: numericAmt,
            reference: reference || 'Hesaplarım Arası Aktarım',
          }),
        });
        setReceiptTx(tx);
      }
      await refreshData();
      showToast(t('transfers.ownBtn'), 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddBeneficiary = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/beneficiaries', {
        method: 'POST',
        body: JSON.stringify({
          name: newBenName,
          iban: newBenIban,
          bankName: newBenBank,
          currency: selectedAccount?.currency || 'TRY',
        }),
      });
      await refreshData();
      setBenModal(false);
      setNewBenName('');
      setNewBenIban('');
      showToast(t('transfers.savedBeneficiaries'), 'success');
    } catch (error: any) {
      setErr(error.message);
    }
  };

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/scheduled-transfers', {
        method: 'POST',
        body: JSON.stringify({
          fromAccountId: selectedAccount?.id,
          beneficiaryName: recipientName || 'Scheduled Recipient',
          beneficiaryIban: recipientIban || 'TR640006200048200006298123',
          amount: numericAmt,
          currency: selectedAccount?.currency || 'TRY',
          frequency: schedFreq,
          nextRunDate: schedDate,
        }),
      });
      await refreshData();
      showToast(t('transfers.tabScheduled'), 'success');
    } catch (error: any) {
      setErr(error.message);
    }
  };

  const payBillOrQr = async (name: string, amt: number, ref: string) => {
    setErr(null);
    setSubmitting(true);
    try {
      const tx = await apiFetch<TransactionRecord>('/api/transactions/transfer', {
        method: 'POST',
        body: JSON.stringify({
          fromAccountId: selectedAccount?.id,
          recipientName: name,
          recipientIban: 'PM-MERCHANT-CLEARING',
          rail: 'INTERNAL_TRANSFER',
          amount: amt,
          reference: ref,
        }),
      });
      await refreshData();
      setReceiptTx(tx);
      showToast(`${formatMoney(amt, selectedAccount?.currency || 'TRY')} → ${name}`, 'success');
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
          <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
            {t('transfers.title')}
          </h1>
          <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">{t('transfers.subtitle')}</p>
        </div>
        <SecondaryButton onClick={() => setBenModal(true)}>
          <Plus className="w-4 h-4 text-[#EA580C]" />
          <span>{t('transfers.newBeneficiary')}</span>
        </SecondaryButton>
      </div>

      {/* Prominent Selectable Source Account Wallet Strip */}
      <div className="space-y-2.5">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
          {t('transfers.selectSource')}
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {accounts.map((acc) => {
            const isSelected = acc.id === selectedAccount?.id;
            return (
              <button
                key={acc.id}
                type="button"
                onClick={() => setFromAccountId(acc.id)}
                className={`relative min-w-[228px] p-4 rounded-2xl border text-left transition-all shrink-0 overflow-hidden ${
                  isSelected
                    ? 'bg-orange-50/70 dark:bg-orange-500/10 border-[#F97316] shadow-sm'
                    : 'bg-white dark:bg-[#111115] border-slate-200 dark:border-white/10 hover:border-orange-300'
                }`}
              >
                {isSelected && <span className="absolute inset-x-0 top-0 h-1 bg-[#F97316]" aria-hidden="true" />}
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold font-mono-num text-[#EA580C] dark:text-orange-400">
                    <Wallet className="w-3.5 h-3.5" />
                    <span>{acc.currency}</span>
                  </span>
                  <span className="text-[11px] font-medium text-slate-400 dark:text-zinc-500">{acc.type}</span>
                </div>
                <div className="text-xl font-display font-bold font-mono-num text-slate-900 dark:text-white mt-2">
                  {formatMoney(acc.availableBalance, acc.currency, hideBalances)}
                </div>
                <div className="text-xs font-semibold text-slate-700 dark:text-zinc-300 truncate mt-1">{acc.label}</div>
                <div className="text-[11px] font-mono-num text-slate-400 dark:text-zinc-500 truncate mt-0.5">
                  {acc.iban}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Transfer Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#18181D] border border-slate-200 dark:border-white/10 overflow-x-auto">
        {[
          { id: 'transfer', label: t('transfers.tabBank') },
          { id: 'own', label: t('transfers.tabOwn') },
          { id: 'qr', label: t('transfers.tabQr') },
          { id: 'bills', label: t('transfers.tabBills') },
          { id: 'scheduled', label: t('transfers.tabScheduled') },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id as any)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              tab === item.id
                ? 'bg-white dark:bg-[#09090B] text-[#EA580C] dark:text-[#FB923C] shadow-sm'
                : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <ErrorBanner message={err} onDismiss={() => setErr(null)} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-6">
          {tab === 'transfer' && (
            <SurfaceCard className="p-5 sm:p-6 space-y-5">
              {/* Quick Saved Recipients */}
              {beneficiaries.length > 0 && (
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-2">
                    {t('transfers.quickRecipients')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {beneficiaries.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => {
                          setRecipientName(b.name);
                          setRecipientIban(b.iban);
                          setBic(b.bic);
                        }}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${
                          recipientIban === b.iban
                            ? 'bg-[#F97316] text-white border-[#F97316]'
                            : 'bg-slate-50 dark:bg-white/[0.04] text-slate-800 dark:text-zinc-200 border-slate-200 dark:border-white/10 hover:border-orange-300'
                        }`}
                      >
                        {b.name} ({b.currency})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Clear Visual Payment Rail Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                  {t('transfers.rail')}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(
                    [
                      { id: 'INTERNAL_TRANSFER', label: 'PRO FAST', meta: '0 · Instant' },
                      { id: 'SEPA_INSTANT', label: 'SEPA Instant', meta: '0.50 · <10s' },
                      { id: 'SEPA_TRANSFER', label: 'SEPA / EFT', meta: '0 · T+1' },
                      { id: 'SWIFT_TRANSFER', label: 'SWIFT', meta: '12.00 · T+2' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setRail(item.id)}
                      className={`p-2.5 rounded-xl border text-left transition-colors ${
                        rail === item.id
                          ? 'border-[#F97316] bg-orange-50/70 dark:bg-orange-500/15'
                          : 'border-slate-200 dark:border-white/10 hover:border-slate-300'
                      }`}
                    >
                      <div className={`text-xs font-bold ${rail === item.id ? 'text-[#EA580C] dark:text-orange-300' : 'text-slate-900 dark:text-white'}`}>
                        {item.label}
                      </div>
                      <div className="text-[11px] font-mono-num text-slate-500 dark:text-zinc-400 mt-0.5">{item.meta}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                  {t('transfers.recipientName')}
                </label>
                <input
                  type="text"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Mert Aydin"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                    {t('transfers.recipientIban')}
                  </label>
                  <input
                    type="text"
                    value={recipientIban}
                    onChange={(e) => setRecipientIban(e.target.value.toUpperCase())}
                    placeholder="TR640006200048200006298123"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                    {t('transfers.bic')}
                  </label>
                  <input
                    type="text"
                    value={bic}
                    onChange={(e) => setBic(e.target.value.toUpperCase())}
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num uppercase"
                  />
                </div>
              </div>

              {/* Bold Money Amount Hero Input + Quick Presets */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 dark:text-zinc-300">
                    {t('transfers.amount')} ({selectedAccount?.currency || 'TRY'})
                  </label>
                  <span className="text-xs font-mono-num text-slate-500">
                    {selectedAccount ? formatMoney(selectedAccount.availableBalance, selectedAccount.currency, hideBalances) : ''}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="px-3 py-2 rounded-xl bg-[#F97316] text-white font-mono-num text-sm font-bold">
                    {selectedAccount?.currency || 'TRY'}
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="flex-1 min-h-[52px] px-4 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-2xl font-display font-bold font-mono-num text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#F97316]"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-[11px] font-semibold text-slate-500 mr-1">{t('transfers.quickAmounts')}:</span>
                  {QUICK_AMOUNTS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAmount(String(preset))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono-num border transition-colors ${
                        Number(amount) === preset
                          ? 'bg-[#F97316] text-white border-[#F97316]'
                          : 'bg-white dark:bg-[#18181D] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-white/10 hover:border-orange-300'
                      }`}
                    >
                      {preset.toLocaleString()} {selectedAccount?.currency || 'TRY'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                  {t('transfers.reference')}
                </label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                />
              </div>

              {/* Clear Cost & Remaining Balance Breakdown */}
              <div className="p-3.5 rounded-xl bg-orange-50/70 dark:bg-orange-500/10 border border-orange-200/80 dark:border-orange-500/20 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-zinc-300">{t('transfers.feeAndEta')}</span>
                  <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                    {formatMoney(fee, selectedAccount?.currency || 'TRY')} · {rail === 'SWIFT_TRANSFER' ? 'T+2' : 'Instant'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-zinc-300">{t('transfers.remainingAfter')}</span>
                  <span className="font-mono-num font-bold text-[#EA580C] dark:text-orange-300">
                    {formatMoney(remainingAfter, selectedAccount?.currency || 'TRY', hideBalances)}
                  </span>
                </div>
              </div>

              <PrimaryButton
                type="button"
                onClick={() => {
                  if (!recipientName || !recipientIban || numericAmt <= 0) {
                    setErr('Alıcı adı, IBAN ve geçerli tutar giriniz.');
                    return;
                  }
                  setErr(null);
                  setConfirmOpen(true);
                }}
                className="w-full !min-h-[48px] text-sm"
              >
                <Send className="w-4 h-4" />
                <span>{t('transfers.reviewBtn')}</span>
              </PrimaryButton>
            </SurfaceCard>
          )}

          {tab === 'own' && (
            <SurfaceCard className="p-5 sm:p-6 space-y-5">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-[#EA580C]" />
                <h2 className="text-base font-display font-bold">{t('transfers.tabOwn')}</h2>
              </div>
              <form onSubmit={submitOwnTransfer} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                      {t('transfers.ownFrom')}
                    </label>
                    <select
                      value={selectedAccount?.id || ''}
                      onChange={(e) => setFromAccountId(e.target.value)}
                      className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label} ({formatMoney(a.availableBalance, a.currency, hideBalances)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                      {t('transfers.ownTo')}
                    </label>
                    <select
                      value={targetOwnAccount?.id || ''}
                      onChange={(e) => setToOwnAccountId(e.target.value)}
                      className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                    >
                      {accounts
                        .filter((a) => a.id !== selectedAccount?.id)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label} ({formatMoney(a.availableBalance, a.currency, hideBalances)})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                    {t('transfers.amount')} ({selectedAccount?.currency})
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full min-h-[50px] px-4 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-2xl font-display font-bold font-mono-num"
                  />
                  <div className="flex flex-wrap gap-2 mt-2">
                    {QUICK_AMOUNTS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setAmount(String(preset))}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/10 text-xs font-mono-num font-bold hover:border-[#F97316]"
                      >
                        {preset.toLocaleString()} {selectedAccount?.currency}
                      </button>
                    ))}
                  </div>
                </div>

                <PrimaryButton type="submit" loading={submitting} className="w-full !min-h-[48px]">
                  <ArrowLeftRight className="w-4 h-4" />
                  <span>{t('transfers.ownBtn')}</span>
                </PrimaryButton>
              </form>
            </SurfaceCard>
          )}

          {tab === 'qr' && (
            <SurfaceCard className="p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-[#EA580C]" />
                <h2 className="text-base font-display font-bold">{t('transfers.tabQr')}</h2>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] flex flex-col sm:flex-row items-center gap-4">
                <div className="w-28 h-28 rounded-xl bg-white p-2 flex items-center justify-center border border-slate-200 shrink-0">
                  <QrCode className="w-20 h-20 text-slate-900" />
                </div>
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="text-xs font-bold">PRO MONEY QR IBAN</div>
                  <div className="text-xs font-mono-num text-slate-600 dark:text-zinc-400 break-all">
                    PMQR:{selectedAccount?.iban}:PRO_MONEY
                  </div>
                </div>
              </div>
              <input
                type="text"
                value={qrPayload}
                onChange={(e) => setQrPayload(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs font-mono-num"
              />
              <PrimaryButton
                loading={submitting}
                onClick={() => {
                  const parts = qrPayload.split(':');
                  const amt = Number(parts[2]) || 45;
                  const merch = parts[3] || 'QR Merchant';
                  payBillOrQr(merch, amt, `QR Pay (${parts[0]})`);
                }}
                className="w-full"
              >
                {t('transfers.tabQr')}
              </PrimaryButton>
            </SurfaceCard>
          )}

          {tab === 'bills' && (
            <SurfaceCard className="p-5 sm:p-6 space-y-4">
              <h2 className="text-base font-display font-bold">{t('transfers.tabBills')}</h2>
              <select
                value={billProvider}
                onChange={(e) => setBillProvider(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
              >
                <option>Turkcell Fiber & Mobile</option>
                <option>İGDAŞ Doğalgaz</option>
                <option>İSKİ / BEDAŞ Elektrik-Su</option>
                <option>AWS Cloud Infrastructure</option>
              </select>
              <input
                type="number"
                min="1"
                value={billAmount}
                onChange={(e) => setBillAmount(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-lg font-mono-num font-bold"
              />
              <PrimaryButton
                loading={submitting}
                onClick={() => payBillOrQr(billProvider, Number(billAmount), `Bill: ${billProvider}`)}
                className="w-full"
              >
                <Receipt className="w-4 h-4" />
                <span>{t('transfers.tabBills')}</span>
              </PrimaryButton>
            </SurfaceCard>
          )}

          {tab === 'scheduled' && (
            <SurfaceCard className="p-5 sm:p-6 space-y-4">
              <h2 className="text-base font-display font-bold">{t('transfers.tabScheduled')}</h2>
              <form onSubmit={handleSchedule} className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-4 border-b border-slate-200 dark:border-white/10">
                <input
                  type="text"
                  placeholder={t('transfers.recipientName')}
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  className="min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                />
                <input
                  type="text"
                  placeholder={t('transfers.recipientIban')}
                  value={recipientIban}
                  onChange={(e) => setRecipientIban(e.target.value)}
                  className="min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
                />
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={schedFreq}
                    onChange={(e) => setSchedFreq(e.target.value)}
                    className="min-h-[44px] px-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs"
                  >
                    <option value="WEEKLY">Weekly</option>
                    <option value="MONTHLY">Monthly</option>
                  </select>
                  <input
                    type="date"
                    value={schedDate}
                    onChange={(e) => setSchedDate(e.target.value)}
                    className="min-h-[44px] px-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs"
                  />
                </div>
                <PrimaryButton type="submit" className="sm:col-span-2">
                  <Calendar className="w-4 h-4" />
                  <span>{t('transfers.tabScheduled')}</span>
                </PrimaryButton>
              </form>
              <div className="space-y-2.5">
                {scheduled.map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] text-xs">
                    <div>
                      <div className="font-semibold">{s.beneficiary_name}</div>
                      <div className="text-slate-500 font-mono-num">{s.frequency} · {s.next_run_date}</div>
                    </div>
                    <div className="font-mono-num font-bold">{formatMoney(s.amount, s.currency, hideBalances)}</div>
                  </div>
                ))}
              </div>
            </SurfaceCard>
          )}
        </div>

        {/* Saved Beneficiaries & Recent Transfers */}
        <div className="lg:col-span-5 space-y-6">
          <SurfaceCard className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-display font-bold flex items-center gap-2">
                <Users className="w-4 h-4 text-[#EA580C]" />
                <span>{t('transfers.savedBeneficiaries')}</span>
              </h3>
            </div>
            <div className="space-y-2">
              {beneficiaries.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between gap-2 p-3 rounded-xl border border-slate-200 dark:border-white/[0.06] hover:border-[#F97316]/60 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setRecipientName(b.name);
                      setRecipientIban(b.iban);
                      setBic(b.bic);
                      setTab('transfer');
                      showToast(b.name, 'info');
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="text-xs font-bold text-slate-900 dark:text-white truncate">{b.name}</div>
                    <div className="text-[11px] text-slate-500 font-mono-num truncate">{b.iban}</div>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/beneficiaries/${b.id}`, { method: 'DELETE' });
                      await refreshData();
                    }}
                    className="p-2 text-slate-400 hover:text-red-500"
                    aria-label="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <h3 className="text-sm font-display font-bold mb-3">{t('transfers.history')}</h3>
            <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
              {transactions.slice(0, 6).map((tx) => (
                <TransactionItem key={tx.id} tx={tx} hideBalance={hideBalances} onSelect={setReceiptTx} />
              ))}
            </div>
          </SurfaceCard>
        </div>
      </div>

      {/* Transfer Confirmation Modal */}
      <ModalSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('transfers.confirmTitle')}
        subtitle={t('transfers.confirmSub')}
      >
        <div className="space-y-3 text-xs">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-white/[0.04] space-y-2.5">
            <div className="flex justify-between">
              <span className="text-slate-500">{t('transfers.recipientName')}</span>
              <span className="font-bold">{recipientName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">{t('transfers.recipientIban')}</span>
              <span className="font-mono-num">{recipientIban}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">{t('transfers.rail')}</span>
              <span>{rail}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-white/10">
              <span className="text-slate-600 font-semibold">{t('transfers.totalDebit')}</span>
              <span className="font-mono-num font-bold text-base text-[#EA580C]">
                {formatMoney(numericAmt + fee, selectedAccount?.currency || 'TRY')}
              </span>
            </div>
          </div>
          <PrimaryButton onClick={submitTransfer} loading={submitting} className="w-full !min-h-[48px]">
            <CheckCircle2 className="w-4 h-4" />
            <span>{t('transfers.authorizeBtn')}</span>
          </PrimaryButton>
        </div>
      </ModalSheet>

      {/* Add Beneficiary Modal */}
      <ModalSheet open={benModal} onClose={() => setBenModal(false)} title={t('transfers.newBeneficiary')}>
        <form onSubmit={handleAddBeneficiary} className="space-y-3">
          <input
            type="text"
            required
            placeholder={t('transfers.recipientName')}
            value={newBenName}
            onChange={(e) => setNewBenName(e.target.value)}
            className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
          />
          <input
            type="text"
            required
            placeholder="IBAN"
            value={newBenIban}
            onChange={(e) => setNewBenIban(e.target.value.toUpperCase())}
            className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
          />
          <input
            type="text"
            placeholder="Bank"
            value={newBenBank}
            onChange={(e) => setNewBenBank(e.target.value)}
            className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
          />
          <PrimaryButton type="submit" className="w-full">
            {t('common.save')}
          </PrimaryButton>
        </form>
      </ModalSheet>

      {/* Receipt Modal */}
      <ModalSheet open={Boolean(receiptTx)} onClose={() => setReceiptTx(null)} title={t('transfers.receiptTitle')}>
        {receiptTx && (
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-center">
              <SemanticStateLabel state={receiptTx.status} />
              <div className="text-3xl font-display font-bold font-mono-num mt-2 text-slate-900 dark:text-white">
                {formatMoney(receiptTx.amount, receiptTx.currency)}
              </div>
              <div className="text-slate-600 dark:text-zinc-300 mt-1">→ {receiptTx.counterpartyName}</div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between"><span className="text-slate-500">Ref</span><span className="font-mono-num">{receiptTx.reference}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Auth</span><span className="font-mono-num">{receiptTx.authorizationCode}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Rail</span><span>{receiptTx.source}</span></div>
            </div>
          </div>
        )}
      </ModalSheet>

      <SandboxNotice message={t('common.sandboxShort')} />
    </div>
  );
};
