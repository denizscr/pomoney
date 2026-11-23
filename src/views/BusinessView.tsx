import React, { useState } from 'react';
import { Building2, FileSpreadsheet, Plus, Receipt, Users } from 'lucide-react';
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

export const BusinessView: React.FC = () => {
  const { data, hideBalances, apiFetch, refreshData, showToast } = useBanking();
  const { t } = useLanguage();
  const business = data?.business;
  const accounts = data?.accounts || [];

  const [memberOpen, setMemberOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const [mName, setMName] = useState('');
  const [mEmail, setMEmail] = useState('');
  const [mRole, setMRole] = useState('Finance Analyst');
  const [mLimit, setMLimit] = useState('5000');

  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cAmount, setCAmount] = useState('1250');

  const [bulkCsv, setBulkCsv] = useState('Lukas Meyer,DE75512108001245126199,450\nNordic Studio,DE89500105175407324931,800');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!business) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-display font-bold tracking-tight">{t('business.title')}</h1>
        <SurfaceCard className="p-6">
          <EmptyState
            title={t('business.title')}
            description={t('auth.approvalNotice')}
          />
        </SurfaceCard>
      </div>
    );
  }

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      await apiFetch('/api/business/members', {
        method: 'POST',
        body: JSON.stringify({
          fullName: mName,
          email: mEmail,
          roleTitle: mRole,
          permissions: ['VIEW_ACCOUNTS', 'INITIATE_PAYMENT'],
          approvalLimit: Number(mLimit),
        }),
      });
      await refreshData();
      setMemberOpen(false);
      setMName('');
      setMEmail('');
      showToast('Team member added with scoped permissions', 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      await apiFetch('/api/business/invoices', {
        method: 'POST',
        body: JSON.stringify({
          clientName: cName,
          clientEmail: cEmail,
          amount: Number(cAmount),
          currency: 'EUR',
        }),
      });
      await refreshData();
      setInvoiceOpen(false);
      setCName('');
      setCEmail('');
      showToast('Invoice generated', 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const lines = bulkCsv
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        const [name, iban, amt] = line.split(',').map((s) => s.trim());
        if (name && iban && Number(amt) > 0) {
          await apiFetch('/api/transactions/transfer', {
            method: 'POST',
            body: JSON.stringify({
              fromAccountId: accounts[0]?.id,
              recipientName: name,
              recipientIban: iban,
              rail: 'SEPA_TRANSFER',
              amount: Number(amt),
              reference: 'Bulk Payroll / Vendor Batch',
            }),
          });
        }
      }
      await refreshData();
      setBulkOpen(false);
      showToast(`Executed ${lines.length} bulk payouts on Core Ledger`, 'success');
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
            <Building2 className="w-5 h-5 text-[#EA580C] dark:text-[#FB923C]" />
            <h1 className="text-2xl font-display font-bold tracking-tight">{business.entity.companyName}</h1>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Reg {business.entity.registrationNumber} · Tax ID {business.entity.taxId} · KYB {business.entity.kybStatus}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton onClick={() => setBulkOpen(true)}>
            <FileSpreadsheet className="w-4 h-4" />
            <span>{t('business.bulkPayout')}</span>
          </SecondaryButton>
          <SecondaryButton onClick={() => setInvoiceOpen(true)}>
            <Receipt className="w-4 h-4" />
            <span>{t('business.newInvoice')}</span>
          </SecondaryButton>
          <PrimaryButton onClick={() => setMemberOpen(true)}>
            <Plus className="w-4 h-4" />
            <span>{t('business.addEmployee')}</span>
          </PrimaryButton>
        </div>
      </div>

      <SandboxNotice message={t('common.sandboxShort')} />
      <ErrorBanner message={err} onDismiss={() => setErr(null)} />

      {/* Company Accounts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accounts.map((acc) => (
          <SurfaceCard key={acc.id} className="p-5">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-xs font-semibold text-slate-500">{acc.type}</div>
                <div className="text-base font-display font-bold mt-0.5">{acc.label}</div>
                <div className="text-xs font-mono-num text-slate-500 mt-1">{acc.iban}</div>
              </div>
              <div className="text-right">
                <div className="text-xl font-display font-bold font-mono-num">
                  {formatMoney(acc.availableBalance, acc.currency, hideBalances)}
                </div>
                <SemanticStateLabel state={acc.status} />
              </div>
            </div>
          </SurfaceCard>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Team & Permissions */}
        <SurfaceCard className="lg:col-span-6 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-display font-bold flex items-center gap-2">
              <Users className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C]" />
              <span>{t('business.teamPermissions')}</span>
            </h2>
          </div>
          <div className="space-y-3">
            {business.members.map((m) => (
              <div key={m.id} className="p-3.5 rounded-xl border border-zinc-200/80 dark:border-white/[0.06] space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{m.fullName}</div>
                    <div className="text-xs text-zinc-500">{m.roleTitle} · {m.email}</div>
                  </div>
                  <SemanticStateLabel state={m.status} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500 pt-1">
                  <span>Permissions: {m.permissions.join(' · ')}</span>
                  <span className="font-mono-num font-semibold text-zinc-900 dark:text-zinc-200">
                    Approval Cap: {formatMoney(m.approvalLimit, 'EUR')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SurfaceCard>

        {/* Business Invoices */}
        <SurfaceCard className="lg:col-span-6 p-5 space-y-4">
          <h2 className="text-sm font-display font-bold">{t('business.invoices')}</h2>
          <div className="space-y-3">
            {business.invoices.map((inv) => (
              <div key={inv.id} className="p-3.5 rounded-xl border border-zinc-200/80 dark:border-white/[0.06] flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-mono-num font-semibold text-[#EA580C] dark:text-[#FB923C]">
                    {inv.invoiceNumber}
                  </div>
                  <div className="text-sm font-semibold truncate">{inv.clientName}</div>
                  <div className="text-xs text-zinc-500">Due {inv.dueDate}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold font-mono-num">
                    {formatMoney(inv.amount, inv.currency, hideBalances)}
                  </div>
                  <SemanticStateLabel state={inv.status} />
                </div>
              </div>
            ))}
          </div>
        </SurfaceCard>
      </div>

      {/* Modals */}
      <ModalSheet open={memberOpen} onClose={() => setMemberOpen(false)} title="Add Business Team Member">
        <form onSubmit={handleAddMember} className="space-y-3">
          <input type="text" required placeholder="Full Name" value={mName} onChange={(e) => setMName(e.target.value)} className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm" />
          <input type="email" required placeholder="Corporate Email" value={mEmail} onChange={(e) => setMEmail(e.target.value)} className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm" />
          <input type="text" required placeholder="Role Title" value={mRole} onChange={(e) => setMRole(e.target.value)} className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm" />
          <input type="number" required placeholder="Approval Limit (EUR)" value={mLimit} onChange={(e) => setMLimit(e.target.value)} className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num" />
          <PrimaryButton type="submit" loading={submitting} className="w-full">Grant Scoped Access</PrimaryButton>
        </form>
      </ModalSheet>

      <ModalSheet open={invoiceOpen} onClose={() => setInvoiceOpen(false)} title="Create Corporate Invoice">
        <form onSubmit={handleCreateInvoice} className="space-y-3">
          <input type="text" required placeholder="Client Name" value={cName} onChange={(e) => setCName(e.target.value)} className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm" />
          <input type="email" required placeholder="Client Accounts Payable Email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm" />
          <input type="number" min="1" step="0.01" required placeholder="Amount (EUR)" value={cAmount} onChange={(e) => setCAmount(e.target.value)} className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num" />
          <PrimaryButton type="submit" loading={submitting} className="w-full">Issue Invoice</PrimaryButton>
        </form>
      </ModalSheet>

      <ModalSheet open={bulkOpen} onClose={() => setBulkOpen(false)} title="Bulk SEPA Payouts (CSV)">
        <form onSubmit={handleBulkRun} className="space-y-3">
          <p className="text-xs text-zinc-500">Format: Recipient Name, IBAN, Amount (one per line)</p>
          <textarea rows={4} value={bulkCsv} onChange={(e) => setBulkCsv(e.target.value)} className="w-full p-3 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs font-mono-num" />
          <PrimaryButton type="submit" loading={submitting} className="w-full">Execute Batch on Core Ledger</PrimaryButton>
        </form>
      </ModalSheet>
    </div>
  );
};
