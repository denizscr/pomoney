import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  Database,
  Download,
  Headset,
  Landmark,
  Layers,
  Lock,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  Unlock,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
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

type AdminTab =
  | 'approvals'
  | 'overview'
  | 'system_settings'
  | 'customers'
  | 'live_support'
  | 'pools_ledger'
  | 'compliance'
  | 'cards_pos'
  | 'providers_cloud'
  | 'audit';

type PortalFilter = 'ALL' | 'Personal' | 'Business' | 'Merchant' | 'Administrator';

export const AdminView: React.FC = () => {
  const { data, token, apiFetch, showToast } = useBanking();
  const { t } = useLanguage();
  const [adminData, setAdminData] = useState<any>(null);
  const [tab, setTab] = useState<AdminTab>('approvals');
  const [portalFilter, setPortalFilter] = useState<PortalFilter>('ALL');
  const [openingCreditMap, setOpeningCreditMap] = useState<Record<string, string>>({});
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('+90 532 000 00 00');
  const [newRole, setNewRole] = useState('INDIVIDUAL_CUSTOMER');
  const [newCurrency, setNewCurrency] = useState('TRY');

  // System Settings state
  const [settingDrafts, setSettingDrafts] = useState<Record<string, { enabled: boolean; feeFixed: string; feePercent: string; maxAmount: string }>>({});
  const [savingSettingKey, setSavingSettingKey] = useState<string | null>(null);
  const [selectedEntUserId, setSelectedEntUserId] = useState<string>('');
  const [savingEntitlementUserId, setSavingEntitlementUserId] = useState<string | null>(null);

  // Money Pool Management & New Partner Bank Pool state
  const [adjustPoolModal, setAdjustPoolModal] = useState<any | null>(null);
  const [adjustDirection, setAdjustDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [adjustAmount, setAdjustAmount] = useState('50000');
  const [adjustReason, setAdjustReason] = useState('Treasury liquidity rebalance');
  const [adjustCustodian, setAdjustCustodian] = useState('');
  const [savingPool, setSavingPool] = useState(false);

  const [newPoolOpen, setNewPoolOpen] = useState(false);
  const [poolCode, setPoolCode] = useState('H');
  const [poolBankName, setPoolBankName] = useState('');
  const [poolName, setPoolName] = useState('');
  const [poolIban, setPoolIban] = useState('');
  const [poolBic, setPoolBic] = useState('');
  const [poolCurrency, setPoolCurrency] = useState('TRY');
  const [poolInitBal, setPoolInitBal] = useState('1000000');
  const [poolRoutingMode, setPoolRoutingMode] = useState<'ALL' | 'INFLOW' | 'OUTFLOW' | 'STANDBY'>('ALL');
  const [poolSetPrimary, setPoolSetPrimary] = useState(true);

  const [transferFromPool, setTransferFromPool] = useState('pool_A');
  const [transferToPool, setTransferToPool] = useState('pool_B');
  const [transferPoolAmount, setTransferPoolAmount] = useState('25000');
  const [transferPoolReason, setTransferPoolReason] = useState('Reserve allocation');

  // Live Support Desk state
  const [selectedTicketId, setSelectedTicketId] = useState<string>('');
  const [adminReplyText, setAdminReplyText] = useState('');
  const [sendingSupportReply, setSendingSupportReply] = useState(false);
  const [downloadingSql, setDownloadingSql] = useState(false);

  // POS Terminal Approval drafts
  const [posModeMap, setPosModeMap] = useState<Record<string, 'ONLINE' | 'OFFLINE' | 'HYBRID'>>({});
  const [posFloorMap, setPosFloorMap] = useState<Record<string, string>>({});

  const loadAdmin = useCallback(async () => {
    try {
      const res = await apiFetch<any>('/api/admin/overview');
      setAdminData(res);
      setErr(null);
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    loadAdmin();
  }, [loadAdmin, data]);

  useEffect(() => {
    if (adminData?.operationSettings) {
      const next: Record<string, { enabled: boolean; feeFixed: string; feePercent: string; maxAmount: string }> = {};
      for (const s of adminData.operationSettings) {
        next[s.key] = {
          enabled: Boolean(s.enabled),
          feeFixed: String(s.feeFixed ?? 0),
          feePercent: String(s.feePercent ?? 0),
          maxAmount: String(s.maxAmount ?? 0),
        };
      }
      setSettingDrafts(next);
    }
    if (adminData?.users?.length && !selectedEntUserId) {
      setSelectedEntUserId(adminData.users[0].id);
    }
  }, [adminData, selectedEntUserId]);

  const pendingApprovals: any[] = adminData?.pendingApprovals || [];
  const allUsers: any[] = adminData?.users || [];
  const selectedEntUser = allUsers.find((u) => u.id === selectedEntUserId) || allUsers[0];

  const filteredUsers = useMemo(() => {
    if (portalFilter === 'ALL') return allUsers;
    return allUsers.filter((u) => u.accountCategory === portalFilter);
  }, [allUsers, portalFilter]);

  const handleApprovalDecision = async (userId: string, decision: 'APPROVED' | 'REJECTED') => {
    setDecidingId(userId);
    setErr(null);
    try {
      const initialBalanceTry = Number(openingCreditMap[userId] ?? '6000') || 0;
      await apiFetch(`/api/admin/approvals/${userId}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision, initialBalanceTry }),
      });
      await loadAdmin();
      showToast(
        decision === 'APPROVED' ? `${t('admin.approveAccount')} (${formatMoney(initialBalanceTry, 'TRY')})` : t('admin.rejectAccount'),
        decision === 'APPROVED' ? 'success' : 'info'
      );
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setDecidingId(null);
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/customers', {
        method: 'POST',
        body: JSON.stringify({
          fullName: newName,
          email: newEmail,
          phone: newPhone,
          role: newRole,
          currency: newCurrency,
        }),
      });
      setCreateUserOpen(false);
      setNewName('');
      setNewEmail('');
      await loadAdmin();
      showToast(t('admin.createUser'), 'success');
    } catch (error: any) {
      setErr(error.message);
    }
  };

  const handleSaveSystemSetting = async (key: string) => {
    const draft = settingDrafts[key];
    if (!draft) return;
    setSavingSettingKey(key);
    setErr(null);
    try {
      await apiFetch(`/api/admin/system-settings/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: draft.enabled,
          feeFixed: Number(draft.feeFixed) || 0,
          feePercent: Number(draft.feePercent) || 0,
          maxAmount: Number(draft.maxAmount) || 0,
        }),
      });
      await loadAdmin();
      showToast(`${key} updated`, 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSavingSettingKey(null);
    }
  };

  const handleToggleUserEntitlement = async (userId: string, field: string, nextValue: boolean) => {
    setSavingEntitlementUserId(userId);
    setErr(null);
    try {
      await apiFetch(`/api/admin/entitlements/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: nextValue }),
      });
      await loadAdmin();
      showToast(`${field}: ${nextValue ? 'ON' : 'OFF'}`, 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSavingEntitlementUserId(null);
    }
  };

  const handlePoolAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustPoolModal) return;
    setSavingPool(true);
    setErr(null);
    try {
      await apiFetch(`/api/admin/pools/${encodeURIComponent(adjustPoolModal.id)}/adjust`, {
        method: 'POST',
        body: JSON.stringify({
          direction: adjustDirection,
          amount: Number(adjustAmount),
          reason: adjustReason,
          custodianStatus: adjustCustodian || undefined,
        }),
      });
      setAdjustPoolModal(null);
      await loadAdmin();
      showToast(`Pool ${adjustPoolModal.code} ${adjustDirection}`, 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSavingPool(false);
    }
  };

  const handlePoolTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPool(true);
    setErr(null);
    try {
      await apiFetch('/api/admin/pools/transfer', {
        method: 'POST',
        body: JSON.stringify({
          fromPoolId: transferFromPool,
          toPoolId: transferToPool,
          amount: Number(transferPoolAmount),
          reason: transferPoolReason,
        }),
      });
      await loadAdmin();
      showToast(`${transferFromPool} -> ${transferToPool}`, 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSavingPool(false);
    }
  };

  const handlePosDecision = async (terminal: any, approvalStatus: 'APPROVED' | 'REJECTED') => {
    setSavingPool(true);
    setErr(null);
    try {
      const mode = posModeMap[terminal.id] || terminal.terminalMode || 'HYBRID';
      const floorLimit = Number(posFloorMap[terminal.id] ?? terminal.offlineFloorLimit ?? 5000);
      await apiFetch(`/api/admin/pos/${encodeURIComponent(terminal.id)}/decide`, {
        method: 'PATCH',
        body: JSON.stringify({
          approvalStatus,
          terminalMode: mode,
          onlineEnabled: approvalStatus === 'APPROVED' && mode !== 'OFFLINE',
          offlineEnabled: approvalStatus === 'APPROVED' && mode !== 'ONLINE',
          offlineFloorLimit: floorLimit,
        }),
      });
      await loadAdmin();
      showToast(`POS ${terminal.serialNumber}: ${approvalStatus}`, approvalStatus === 'APPROVED' ? 'success' : 'info');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSavingPool(false);
    }
  };

  const handleCreatePool = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPool(true);
    setErr(null);
    try {
      await apiFetch('/api/admin/pools', {
        method: 'POST',
        body: JSON.stringify({
          code: poolCode,
          bankName: poolBankName,
          name: poolName,
          iban: poolIban,
          bic: poolBic,
          currency: poolCurrency,
          initialBalance: Number(poolInitBal) || 0,
          routingMode: poolRoutingMode,
          setAsPrimaryClearing: poolSetPrimary,
        }),
      });
      setNewPoolOpen(false);
      setPoolBankName('');
      setPoolName('');
      setPoolIban('');
      setPoolBic('');
      await loadAdmin();
      showToast(t('admin.poolCreatedToast'), 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSavingPool(false);
    }
  };

  const handleSetPrimaryClearingPool = async (poolId: string) => {
    setSavingPool(true);
    setErr(null);
    try {
      await apiFetch(`/api/admin/pools/${encodeURIComponent(poolId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ setAsPrimaryClearing: true, routingMode: 'ALL' }),
      });
      await loadAdmin();
      showToast(t('admin.poolPrimarySetToast'), 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSavingPool(false);
    }
  };

  const handleToggleUserLock = async (userId: string, shouldUnlock: boolean) => {
    setErr(null);
    try {
      await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/${shouldUnlock ? 'unlock' : 'lock'}`, {
        method: 'POST',
        body: JSON.stringify(shouldUnlock ? {} : { reason: 'Yönetim güvenliği tarafından kilitlendi' }),
      });
      await loadAdmin();
      showToast(shouldUnlock ? t('admin.userUnlockedToast') : t('admin.userLockedToast'), 'success');
    } catch (error: any) {
      setErr(error.message);
    }
  };

  const handleDownloadSql = async () => {
    if (!token) return;
    setDownloadingSql(true);
    try {
      const res = await fetch('/api/admin/export.sql', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('SQL dışa aktarma başarısız.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pro-money-database.sql';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('pro-money-database.sql', 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setDownloadingSql(false);
    }
  };

  const adminTickets: any[] = adminData?.tickets || [];
  const activeSupportTickets = adminTickets.filter((tk) => tk.status !== 'RESOLVED');
  const selectedTicket = adminTickets.find((tk) => tk.id === selectedTicketId) || adminTickets[0] || null;

  const handleAdminReplyTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !adminReplyText.trim()) return;
    setSendingSupportReply(true);
    setErr(null);
    try {
      await apiFetch(`/api/tickets/${encodeURIComponent(selectedTicket.id)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message: adminReplyText.trim() }),
      });
      setAdminReplyText('');
      await loadAdmin();
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSendingSupportReply(false);
    }
  };

  const handleResolveTicket = async (ticketId: string) => {
    setErr(null);
    try {
      await apiFetch(`/api/admin/tickets/${encodeURIComponent(ticketId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'RESOLVED' }),
      });
      await loadAdmin();
      showToast('Çözüldü', 'success');
    } catch (error: any) {
      setErr(error.message);
    }
  };

  if (loading && !adminData) {
    return <div className="p-8 text-sm text-slate-500">{t('common.loading')}</div>;
  }

  const portalLabel = (cat: string) => {
    if (cat === 'Business') return t('admin.filterBusiness');
    if (cat === 'Merchant') return t('admin.filterMerchant');
    if (cat === 'Administrator') return t('admin.filterAdmin');
    return t('admin.filterPersonal');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#F97316]" />
            <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
              {t('admin.title')}
            </h1>
          </div>
          <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">{t('admin.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <SecondaryButton onClick={loadAdmin}>
            <RefreshCw className="w-4 h-4" />
            <span>{t('admin.syncNow')}</span>
          </SecondaryButton>
          <PrimaryButton onClick={() => setCreateUserOpen(true)}>
            <Plus className="w-4 h-4" />
            <span>{t('admin.createUser')}</span>
          </PrimaryButton>
        </div>
      </div>

      <SandboxNotice message={t('common.sandboxShort')} />

      <ErrorBanner message={err} onDismiss={() => setErr(null)} />

      {/* Admin Sub-Navigation */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#18181D] border border-slate-200 dark:border-white/10 overflow-x-auto">
        {[
          { id: 'approvals', label: t('admin.tabApprovals'), badge: pendingApprovals.length },
          { id: 'overview', label: t('admin.tabOverview') },
          { id: 'system_settings', label: t('admin.tabSystemSettings') },
          { id: 'customers', label: t('admin.tabPortals'), badge: allUsers.filter((u: any) => u.isLocked).length },
          { id: 'live_support', label: t('admin.tabLiveSupport'), badge: activeSupportTickets.length },
          { id: 'pools_ledger', label: t('admin.tabPools') },
          { id: 'compliance', label: t('admin.tabCompliance') },
          { id: 'cards_pos', label: t('admin.tabCardsPos'), badge: (adminData?.terminals || []).filter((pt: any) => pt.approvalStatus === 'PENDING_APPROVAL').length },
          { id: 'providers_cloud', label: t('admin.tabProviders') },
          { id: 'audit', label: t('admin.tabAudit') },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id as AdminTab)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              tab === item.id
                ? 'bg-white dark:bg-[#09090B] text-[#EA580C] dark:text-[#FB923C] shadow-sm'
                : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            <span>{item.label}</span>
            {typeof item.badge === 'number' && item.badge > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-[#F97316] text-white text-[10px] font-bold font-mono-num">
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ACCOUNT APPROVALS QUEUE */}
      {adminData && tab === 'approvals' && (
        <SurfaceCard className="p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-white/10">
            <div>
              <h2 className="text-base font-display font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                <UserCheck className="w-4 h-4 text-[#F97316]" />
                <span>{t('admin.pendingApprovalsTitle')}</span>
              </h2>
              <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">{t('admin.pendingApprovalsDesc')}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-orange-50 dark:bg-orange-500/15 text-[#EA580C] dark:text-orange-300 text-xs font-bold">
              <Clock className="w-3.5 h-3.5" />
              <span>{pendingApprovals.length}</span>
            </span>
          </div>

          {pendingApprovals.length === 0 ? (
            <EmptyState title={t('admin.noPendingApprovals')} description={t('admin.pendingApprovalsDesc')} />
          ) : (
            <div className="space-y-4">
              {pendingApprovals.map((app) => {
                const creditVal = openingCreditMap[app.id] ?? '6000';
                const Icon =
                  app.accountCategory === 'Business'
                    ? Building2
                    : app.accountCategory === 'Merchant'
                    ? Store
                    : Users;
                return (
                  <div
                    key={app.id}
                    className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#EA580C] dark:text-orange-400">
                          <Icon className="w-3.5 h-3.5" />
                          <span>{portalLabel(app.accountCategory)}</span>
                        </span>
                        <span className="text-slate-300 dark:text-zinc-600">·</span>
                        <span className="text-xs font-mono-num font-semibold text-slate-600 dark:text-zinc-300">
                          #{app.customerNumber}
                        </span>
                        <span className="text-slate-300 dark:text-zinc-600">·</span>
                        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                          {t('admin.pendingStatus')}
                        </span>
                      </div>
                      <div className="text-base font-display font-bold text-slate-900 dark:text-white">
                        {app.fullName}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-zinc-400 font-mono-num">
                        {app.phone} · {app.email} · {app.country}
                      </div>
                      {(app.requestedCompanyName || app.requestedTaxId) && (
                        <div className="text-xs font-semibold text-slate-800 dark:text-zinc-200">
                          {app.requestedCompanyName} {app.requestedTaxId ? `(${app.requestedTaxId})` : ''}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-end gap-3 shrink-0">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                          {t('admin.initialCreditTry')}
                        </label>
                        <div className="flex items-center gap-1.5">
                          {['0', '6000', '10000'].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setOpeningCreditMap((p) => ({ ...p, [app.id]: preset }))}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-mono-num font-bold border ${
                                creditVal === preset
                                  ? 'bg-slate-900 text-white border-slate-900 dark:bg-[#F97316] dark:border-[#F97316]'
                                  : 'bg-white dark:bg-[#18181D] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-white/10'
                              }`}
                            >
                              ₺{Number(preset).toLocaleString()}
                            </button>
                          ))}
                          <input
                            type="number"
                            min="0"
                            step="100"
                            value={creditVal}
                            onChange={(e) => setOpeningCreditMap((p) => ({ ...p, [app.id]: e.target.value }))}
                            className="w-24 min-h-[34px] px-2.5 rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs font-mono-num font-bold"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <SecondaryButton
                          disabled={decidingId === app.id}
                          onClick={() => handleApprovalDecision(app.id, 'REJECTED')}
                          className="!min-h-[40px] !py-1.5 !px-3 text-xs !text-red-600 hover:!bg-red-50"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>{t('admin.rejectAccount')}</span>
                        </SecondaryButton>
                        <PrimaryButton
                          loading={decidingId === app.id}
                          onClick={() => handleApprovalDecision(app.id, 'APPROVED')}
                          className="!min-h-[40px] !py-1.5 !px-4 text-xs"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{t('admin.approveAccount')}</span>
                        </PrimaryButton>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SurfaceCard>
      )}

      {adminData && tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SurfaceCard className="p-4">
              <div className="text-xs text-slate-500 dark:text-zinc-400">{t('admin.totalUsers')}</div>
              <div className="text-2xl font-display font-bold font-mono-num mt-1">{adminData.users.length}</div>
            </SurfaceCard>
            <SurfaceCard className="p-4">
              <div className="text-xs text-slate-500 dark:text-zinc-400">{t('admin.tabApprovals')}</div>
              <div className="text-2xl font-display font-bold font-mono-num text-[#EA580C] dark:text-[#FB923C] mt-1">
                {pendingApprovals.length}
              </div>
            </SurfaceCard>
            <SurfaceCard className="p-4">
              <div className="text-xs text-slate-500 dark:text-zinc-400">{t('admin.reconciliation')}</div>
              <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mt-2 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                <span>{adminData.reconciliation.isBalanced ? t('admin.balanced') : t('admin.discrepancy')}</span>
              </div>
            </SurfaceCard>
            <SurfaceCard className="p-4">
              <div className="text-xs text-slate-500 dark:text-zinc-400">{t('admin.openAml')}</div>
              <div className="text-2xl font-display font-bold font-mono-num text-amber-600 dark:text-amber-400 mt-1">
                {adminData.amlCases.filter((c: any) => c.status === 'OPEN').length}
              </div>
            </SurfaceCard>
          </div>

          <SurfaceCard className="p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h2 className="text-sm font-display font-bold flex items-center gap-2">
                <Database className="w-4 h-4 text-[#F97316]" />
                <span>{t('admin.dbStatsTitle')}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-mono-num text-emerald-700 dark:text-emerald-400 font-semibold">
                  WS: {adminData.realtimeBreakdown?.ws ?? 0} · SSE: {adminData.realtimeBreakdown?.sse ?? 0} · {t('admin.dbStatsEngine')}
                </span>
                <SecondaryButton
                  onClick={handleDownloadSql}
                  disabled={downloadingSql}
                  className="!min-h-[32px] !py-1 !px-3 text-xs"
                >
                  <Download className="w-3.5 h-3.5 text-[#EA580C]" />
                  <span>{t('admin.exportSqlBtn')}</span>
                </SecondaryButton>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 text-xs">
              {(adminData.dbStats || []).map((st: { table: string; count: number }) => (
                <div
                  key={st.table}
                  className="p-3 rounded-xl border border-slate-200/80 dark:border-white/[0.06] bg-slate-50/70 dark:bg-white/[0.02] flex items-center justify-between gap-2"
                >
                  <span className="font-mono-num font-semibold text-slate-700 dark:text-zinc-300 truncate">
                    {st.table}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-orange-100 text-[#EA580C] dark:bg-orange-500/20 dark:text-orange-300 font-mono-num font-bold">
                    {st.count}
                  </span>
                </div>
              ))}
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <h2 className="text-sm font-display font-bold mb-3">{t('admin.readiness')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              {[
                ['Core Double-Entry Ledger', 'Implemented · Tested · Sandbox Only'],
                ['Real-Time SSE Multi-Device Sync', 'Implemented · Tested · Connected'],
                ['Portal Isolation & Management Approval', 'Implemented · Tested · Active'],
                ['4-Pillar KYC (ID, Passport, Address, OTP)', 'Implemented · Tested · Active'],
                ['Visa / Mastercard / TROY Issuing', 'Sandbox Only · Requires BIN Sponsor'],
                ['SEPA / SWIFT / FAST Clearing', 'Sandbox Only · Requires Banking Partner'],
                ['POS Hardware & Acquiring', 'Sandbox Only · Requires Certification'],
                ['AI Financial Assistant (Gemini)', 'Implemented · Connected (Scoped)'],
                ['SQLite Local Bank Engine', 'Active · Zero External Cloud Dependency'],
              ].map(([mod, status]) => (
                <div key={mod} className="p-3 rounded-xl border border-slate-200/80 dark:border-white/[0.06] flex flex-col gap-1">
                  <span className="font-semibold text-slate-900 dark:text-white">{mod}</span>
                  <span className="text-slate-500 dark:text-zinc-400">{status}</span>
                </div>
              ))}
            </div>
          </SurfaceCard>
        </div>
      )}

      {/* SYSTEM SETTINGS & USER ENTITLEMENTS MATRIX */}
      {adminData && tab === 'system_settings' && (
        <div className="space-y-6">
          <SurfaceCard className="p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-white/10">
              <div>
                <h2 className="text-base font-display font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                  <SlidersHorizontal className="w-4 h-4 text-[#F97316]" />
                  <span>{t('admin.systemSettingsTitle')}</span>
                </h2>
                <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">{t('admin.systemSettingsDesc')}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(adminData.operationSettings || []).map((setting: any) => {
                const draft = settingDrafts[setting.key] || {
                  enabled: Boolean(setting.enabled),
                  feeFixed: String(setting.feeFixed ?? 0),
                  feePercent: String(setting.feePercent ?? 0),
                  maxAmount: String(setting.maxAmount ?? 0),
                };
                const isMaintenance = setting.key === 'MAINTENANCE_MODE';
                return (
                  <div
                    key={setting.key}
                    className={`p-4 rounded-2xl border space-y-3 ${
                      isMaintenance && draft.enabled
                        ? 'border-red-300 bg-red-50/60 dark:border-red-500/40 dark:bg-red-500/10'
                        : 'border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-mono-num font-bold text-[#EA580C] dark:text-[#FB923C]">
                          {setting.key}
                        </div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                          {setting.label}
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={draft.enabled}
                        onClick={() =>
                          setSettingDrafts((prev) => ({
                            ...prev,
                            [setting.key]: { ...draft, enabled: !draft.enabled },
                          }))
                        }
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${
                          draft.enabled ? (isMaintenance ? 'bg-red-600' : 'bg-[#F97316]') : 'bg-slate-300 dark:bg-zinc-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            draft.enabled ? 'translate-x-5' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">Sabit Ücret</label>
                        <input
                          type="number"
                          step="0.01"
                          value={draft.feeFixed}
                          onChange={(e) =>
                            setSettingDrafts((prev) => ({
                              ...prev,
                              [setting.key]: { ...draft, feeFixed: e.target.value },
                            }))
                          }
                          className="w-full min-h-[36px] px-2.5 rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] font-mono-num text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">Komisyon (%)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={draft.feePercent}
                          onChange={(e) =>
                            setSettingDrafts((prev) => ({
                              ...prev,
                              [setting.key]: { ...draft, feePercent: e.target.value },
                            }))
                          }
                          className="w-full min-h-[36px] px-2.5 rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] font-mono-num text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">Limit / Eşik</label>
                        <input
                          type="number"
                          step="1"
                          value={draft.maxAmount}
                          onChange={(e) =>
                            setSettingDrafts((prev) => ({
                              ...prev,
                              [setting.key]: { ...draft, maxAmount: e.target.value },
                            }))
                          }
                          className="w-full min-h-[36px] px-2.5 rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] font-mono-num text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] font-mono-num text-slate-400">
                        {setting.updatedAt ? new Date(setting.updatedAt).toLocaleString() : 'SQLite Active'}
                      </span>
                      <PrimaryButton
                        loading={savingSettingKey === setting.key}
                        onClick={() => handleSaveSystemSetting(setting.key)}
                        className="!min-h-[34px] !py-1 !px-3 text-xs"
                      >
                        {t('common.save')}
                      </PrimaryButton>
                    </div>
                  </div>
                );
              })}
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-white/10">
              <h2 className="text-base font-display font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                <Users className="w-4 h-4 text-[#F97316]" />
                <span>{t('admin.userEntitlementsTitle')}</span>
              </h2>
              <select
                value={selectedEntUser?.id || ''}
                onChange={(e) => setSelectedEntUserId(e.target.value)}
                className="min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs font-semibold"
              >
                {allUsers.map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} (#{u.customerNumber}) — {u.accountCategory}
                  </option>
                ))}
              </select>
            </div>

            {selectedEntUser && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  ['allowPosOnline', 'Online POS Tahsilat'],
                  ['allowPosOffline', 'Offline POS Tahsilat'],
                  ['allowSwift', 'SWIFT Transfer'],
                  ['allowCreditCards', 'Kredi Kartı İhracı'],
                  ['allowDebitCards', 'Banka Kartı İhracı'],
                  ['allowCardTopup', 'Kart ile Bakiye Yükle'],
                  ['allowLoans', 'Kredi Başvurusu'],
                  ['allowQrBills', 'QR & Fatura Ödeme'],
                ].map(([field, label]) => {
                  const enabled = Boolean(selectedEntUser.entitlements?.[field]);
                  return (
                    <div
                      key={field}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] flex items-center justify-between gap-2"
                    >
                      <span className="text-xs font-semibold text-slate-800 dark:text-zinc-200">{label}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        disabled={savingEntitlementUserId === selectedEntUser.id}
                        onClick={() => handleToggleUserEntitlement(selectedEntUser.id, field, !enabled)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${
                          enabled ? 'bg-[#F97316]' : 'bg-slate-300 dark:bg-zinc-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            enabled ? 'translate-x-5' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </SurfaceCard>
        </div>
      )}

      {adminData && tab === 'customers' && (
        <SurfaceCard className="p-5 space-y-4 overflow-x-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C]" />
              <h2 className="text-sm font-display font-bold">{t('admin.customersTableTitle')}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ['ALL', t('admin.filterAll')],
                  ['Personal', t('admin.filterPersonal')],
                  ['Business', t('admin.filterBusiness')],
                  ['Merchant', t('admin.filterMerchant')],
                  ['Administrator', t('admin.filterAdmin')],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPortalFilter(id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    portalFilter === id
                      ? 'bg-[#F97316] text-white border-[#F97316]'
                      : 'bg-slate-50 dark:bg-white/[0.03] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-white/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-white/10 text-slate-500">
                <th className="py-2 pr-4">{t('admin.colName')}</th>
                <th className="py-2 pr-4">{t('admin.colContact')}</th>
                <th className="py-2 pr-4">{t('admin.colPortal')}</th>
                <th className="py-2 pr-4">{t('admin.colStatus')}</th>
                <th className="py-2 pr-4">{t('admin.colTier')}</th>
                <th className="py-2 pr-4">{t('admin.colVerif')}</th>
                <th className="py-2 pr-4">{t('admin.colKyc')}</th>
                <th className="py-2 pr-4">{t('admin.colSecurity')}</th>
                <th className="py-2 text-right">{t('admin.colMfa')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
              {filteredUsers.map((u: any) => (
                <tr key={u.id} className="hover:bg-slate-50/80 dark:hover:bg-white/[0.02] transition-colors">
                  <td className="py-2.5 pr-4">
                    <div className="font-semibold text-slate-900 dark:text-white">{u.fullName}</div>
                    <div className="font-mono-num text-[11px] text-slate-500">#{u.customerNumber}</div>
                  </td>
                  <td className="py-2.5 pr-4 font-mono-num text-slate-600 dark:text-zinc-300">
                    <div>{u.phone}</div>
                    <div className="text-[11px] text-slate-400">{u.email}</div>
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="font-semibold text-[#EA580C] dark:text-orange-400">{portalLabel(u.accountCategory)}</div>
                    <div className="text-[11px] text-slate-500">{u.role}</div>
                  </td>
                  <td className="py-2.5 pr-4">
                    <SemanticStateLabel
                      state={u.approvalStatus}
                      label={
                        u.approvalStatus === 'APPROVED'
                          ? t('admin.approvedStatus')
                          : u.approvalStatus === 'REJECTED'
                          ? t('admin.rejectedStatus')
                          : t('admin.pendingStatus')
                      }
                    />
                  </td>
                  <td className="py-2.5 pr-4">{u.membershipTier}</td>
                  <td className="py-2.5 pr-4">
                    <div className="flex flex-wrap gap-1 font-mono-num text-[10px] font-bold">
                      {[
                        ['ID', u.identityVerified],
                        ['PAS', u.passportVerified],
                        ['ADR', u.addressVerified],
                        ['TEL', u.phoneVerified],
                      ].map(([lbl, ok]) => (
                        <span
                          key={String(lbl)}
                          className={`px-1.5 py-0.5 rounded ${
                            ok
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                              : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-zinc-400'
                          }`}
                        >
                          {lbl}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4">
                    <SemanticStateLabel state={u.kycStatus} />
                  </td>
                  <td className="py-2.5 pr-4">
                    {u.isLocked ? (
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300 font-bold text-[10px]">
                          KİLİTLİ
                        </span>
                        <button
                          type="button"
                          onClick={() => handleToggleUserLock(u.id, true)}
                          className="px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 inline-flex items-center gap-1"
                        >
                          <Unlock className="w-3 h-3" />
                          <span>{t('admin.unlockBtn')}</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleToggleUserLock(u.id, false)}
                        className="px-2 py-1 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-zinc-300 hover:border-red-300 hover:text-red-600 text-[10px] font-semibold inline-flex items-center gap-1"
                      >
                        <Lock className="w-3 h-3" />
                        <span>{t('admin.lockBtn')}</span>
                      </button>
                    )}
                  </td>
                  <td className="py-2.5 text-right font-mono-num">{u.mfaEnabled ? 'ON' : 'OFF'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SurfaceCard>
      )}

      {/* LIVE SUPPORT DESK & ACCOUNT UNLOCK CENTER */}
      {adminData && tab === 'live_support' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <SurfaceCard className="lg:col-span-5 p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-white/10">
              <h2 className="text-sm font-display font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                <Headset className="w-4 h-4 text-[#F97316]" />
                <span>{t('admin.liveSupportTitle')} ({adminTickets.length})</span>
              </h2>
            </div>

            {adminTickets.length === 0 ? (
              <EmptyState title={t('admin.liveSupportEmpty')} description={t('support.liveDesc')} />
            ) : (
              <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
                {adminTickets.map((tk: any) => {
                  const active = selectedTicket?.id === tk.id;
                  return (
                    <button
                      key={tk.id}
                      type="button"
                      onClick={() => setSelectedTicketId(tk.id)}
                      className={`w-full p-3.5 rounded-xl border text-left transition-all space-y-1.5 ${
                        active
                          ? 'border-[#F97316] bg-orange-50/70 dark:bg-orange-500/15'
                          : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] hover:border-orange-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {tk.userName || tk.userId} {tk.userCustomerNumber ? `(#${tk.userCustomerNumber})` : ''}
                        </span>
                        <SemanticStateLabel state={tk.status} />
                      </div>
                      <div className="text-xs font-semibold text-[#EA580C] truncate">{tk.subject}</div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400">
                        <span>{tk.channel || 'TICKET'}</span>
                        {tk.userIsLocked && (
                          <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold text-[10px]">
                            KİLİTLİ HESAP
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </SurfaceCard>

          <SurfaceCard className="lg:col-span-7 p-5 sm:p-6 space-y-4">
            {selectedTicket ? (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-white/10">
                  <div>
                    <h3 className="text-base font-display font-bold text-slate-900 dark:text-white">
                      {selectedTicket.subject}
                    </h3>
                    <div className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                      {selectedTicket.userName} · {selectedTicket.userEmail} · #{selectedTicket.userCustomerNumber}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {(selectedTicket.userIsLocked || selectedTicket.channel === 'UNLOCK_REQUEST') && (
                      <PrimaryButton
                        onClick={() => handleToggleUserLock(selectedTicket.userId, true)}
                        className="!min-h-[34px] !py-1 !px-3 text-xs !bg-emerald-600 hover:!bg-emerald-700"
                      >
                        <Unlock className="w-3.5 h-3.5" />
                        <span>{t('admin.unlockAccountOneClick')}</span>
                      </PrimaryButton>
                    )}
                    {selectedTicket.status !== 'RESOLVED' && (
                      <SecondaryButton
                        onClick={() => handleResolveTicket(selectedTicket.id)}
                        className="!min-h-[34px] !py-1 !px-3 text-xs"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{t('admin.markResolvedBtn')}</span>
                      </SecondaryButton>
                    )}
                  </div>
                </div>

                <div className="h-80 overflow-y-auto space-y-2.5 p-3.5 rounded-2xl bg-slate-50/90 dark:bg-white/[0.02] border border-slate-200/80 dark:border-white/[0.08]">
                  {(selectedTicket.messages || []).map((m: any) => {
                    const isSupport = m.senderRole !== 'INDIVIDUAL_CUSTOMER' && m.senderRole !== 'BUSINESS_MANAGER' && m.senderRole !== 'MERCHANT' && m.senderRole !== 'CORPORATE_CUSTOMER';
                    return (
                      <div key={m.id} className={`flex ${isSupport ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs shadow-sm ${
                            isSupport
                              ? 'bg-[#F97316] text-white'
                              : 'bg-white dark:bg-[#18181D] text-slate-800 dark:text-zinc-200 border border-slate-200 dark:border-white/10'
                          }`}
                        >
                          <div className={`text-[10px] font-bold mb-0.5 ${isSupport ? 'text-orange-100' : 'text-[#EA580C]'}`}>
                            {m.senderName} ({m.senderRole}) · {new Date(m.createdAt).toLocaleTimeString()}
                          </div>
                          <p className="leading-relaxed">{m.message}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <form onSubmit={handleAdminReplyTicket} className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={adminReplyText}
                    onChange={(e) => setAdminReplyText(e.target.value)}
                    placeholder={t('support.livePlaceholder')}
                    className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                  />
                  <PrimaryButton type="submit" loading={sendingSupportReply} className="!min-h-[44px] px-4">
                    <Send className="w-4 h-4" />
                    <span>{t('support.sendBtn')}</span>
                  </PrimaryButton>
                </form>
              </>
            ) : (
              <EmptyState title={t('admin.liveSupportEmpty')} description={t('support.liveDesc')} />
            )}
          </SurfaceCard>
        </div>
      )}

      {adminData && tab === 'pools_ledger' && (
        <div className="space-y-6">
          <SurfaceCard className="p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-display font-bold flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#F97316]" />
                  <span>{t('admin.poolsTitle')}</span>
                </h2>
                <span className="text-xs font-mono-num text-emerald-600 font-semibold">
                  Debits {formatMoney(adminData.reconciliation.totalDebits)} = Credits {formatMoney(adminData.reconciliation.totalCredits)} ·{' '}
                  {adminData.reconciliation.isBalanced ? t('admin.balanced') : t('admin.discrepancy')}
                </span>
              </div>
              <PrimaryButton onClick={() => setNewPoolOpen(true)} className="!min-h-[38px] text-xs">
                <Plus className="w-4 h-4" />
                <span>{t('admin.addBankPoolBtn')}</span>
              </PrimaryButton>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {adminData.pools.map((p: any) => {
                const isPrimary = Number(p.is_primary_clearing || 0) === 1;
                return (
                  <div
                    key={p.id}
                    className={`p-4 rounded-2xl border flex flex-col justify-between gap-3 ${
                      isPrimary
                        ? 'border-[#F97316] bg-orange-50/60 dark:bg-orange-500/10 shadow-sm'
                        : 'border-slate-200/80 dark:border-white/[0.08] bg-slate-50/60 dark:bg-white/[0.02]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="font-bold text-[#EA580C] dark:text-[#FB923C]">
                          POOL {p.code} {p.routing_mode ? `· ${p.routing_mode}` : ''}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {isPrimary && (
                            <span className="px-2 py-0.5 rounded-md bg-[#F97316] text-white text-[10px] font-bold">
                              {t('admin.primaryClearingBadge')}
                            </span>
                          )}
                          <span className="font-mono-num text-slate-500">{p.currency}</span>
                        </div>
                      </div>
                      <div className="text-sm font-semibold mt-1 text-slate-900 dark:text-white">{p.name}</div>
                      {p.bank_name && (
                        <div className="text-xs font-medium text-slate-600 dark:text-zinc-300 flex items-center gap-1 mt-0.5">
                          <Landmark className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
                          <span className="truncate">{p.bank_name}</span>
                        </div>
                      )}
                      {p.iban && (
                        <div className="text-[11px] font-mono-num text-slate-500 truncate mt-0.5">
                          {p.iban} {p.bic ? `· ${p.bic}` : ''}
                        </div>
                      )}
                      <div className="text-xl font-display font-bold font-mono-num mt-1.5 text-slate-900 dark:text-white">
                        {formatMoney(p.balance, p.currency)}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">{p.custodian_status}</div>
                    </div>
                    <div className="space-y-2 pt-2 border-t border-slate-200/70 dark:border-white/[0.06]">
                      <div className="flex items-center gap-2">
                        <SecondaryButton
                          onClick={() => {
                            setAdjustPoolModal(p);
                            setAdjustDirection('CREDIT');
                            setAdjustAmount('50000');
                            setAdjustReason(`Pool ${p.code} liquidity credit`);
                            setAdjustCustodian(p.custodian_status || '');
                          }}
                          className="!min-h-[32px] !py-1 !px-2.5 text-[11px] flex-1"
                        >
                          {t('admin.poolCredit')}
                        </SecondaryButton>
                        <SecondaryButton
                          onClick={() => {
                            setAdjustPoolModal(p);
                            setAdjustDirection('DEBIT');
                            setAdjustAmount('10000');
                            setAdjustReason(`Pool ${p.code} treasury debit`);
                            setAdjustCustodian(p.custodian_status || '');
                          }}
                          className="!min-h-[32px] !py-1 !px-2.5 text-[11px] flex-1"
                        >
                          {t('admin.poolDebit')}
                        </SecondaryButton>
                      </div>
                      {!isPrimary && (
                        <button
                          type="button"
                          disabled={savingPool}
                          onClick={() => handleSetPrimaryClearingPool(p.id)}
                          className="w-full py-1.5 px-2.5 rounded-xl border border-orange-300 dark:border-orange-500/40 bg-white dark:bg-[#18181D] text-[#EA580C] dark:text-orange-300 text-[11px] font-bold hover:bg-orange-50 transition-colors"
                        >
                          {t('admin.setPrimaryClearingBtn')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </SurfaceCard>

          {/* Inter-Pool Transfer */}
          <SurfaceCard className="p-5 sm:p-6 space-y-4">
            <h2 className="text-sm font-display font-bold flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-[#F97316]" />
              <span>{t('admin.poolTransferTitle')}</span>
            </h2>
            <form onSubmit={handlePoolTransfer} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Kaynak Havuz</label>
                <select
                  value={transferFromPool}
                  onChange={(e) => setTransferFromPool(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs font-semibold"
                >
                  {adminData.pools.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      Pool {p.code} — {formatMoney(p.balance, p.currency)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Hedef Havuz</label>
                <select
                  value={transferToPool}
                  onChange={(e) => setTransferToPool(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs font-semibold"
                >
                  {adminData.pools.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      Pool {p.code} — {formatMoney(p.balance, p.currency)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">{t('transfers.amount')}</label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  required
                  value={transferPoolAmount}
                  onChange={(e) => setTransferPoolAmount(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs font-mono-num font-bold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Açıklama</label>
                <input
                  type="text"
                  required
                  value={transferPoolReason}
                  onChange={(e) => setTransferPoolReason(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs"
                />
              </div>
              <PrimaryButton type="submit" loading={savingPool} className="!min-h-[40px] text-xs">
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>{t('transfers.authorizeBtn')}</span>
              </PrimaryButton>
            </form>
          </SurfaceCard>

          {/* Pool Ledger Entries */}
          <SurfaceCard className="p-5 overflow-x-auto">
            <h2 className="text-sm font-display font-bold mb-3">{t('admin.poolLedgerTitle')}</h2>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 text-slate-500">
                  <th className="py-2 pr-3">Pool</th>
                  <th className="py-2 pr-3">Entry</th>
                  <th className="py-2 pr-3">Amount</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {(adminData.poolLedgerEntries || []).slice(0, 25).map((le: any) => (
                  <tr key={le.id}>
                    <td className="py-2 pr-3 font-mono-num font-bold text-[#EA580C]">{le.pool_id}</td>
                    <td className="py-2 pr-3 font-mono-num font-semibold">{le.entry_type}</td>
                    <td className="py-2 pr-3 font-mono-num font-semibold">{formatMoney(le.amount, le.currency)}</td>
                    <td className="py-2 pr-3 text-slate-600 dark:text-zinc-300">{le.description}</td>
                    <td className="py-2 font-mono-num text-slate-400">{new Date(le.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SurfaceCard>

          <SurfaceCard className="p-5 overflow-x-auto">
            <h2 className="text-sm font-display font-bold mb-3">{t('admin.txReversalTitle')}</h2>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 text-slate-500">
                  <th className="py-2 pr-3">Ref</th>
                  <th className="py-2 pr-3">{t('transfers.recipientName')}</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">{t('transfers.amount')}</th>
                  <th className="py-2 pr-3">{t('admin.colStatus')}</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {adminData.transactions.slice(0, 20).map((tx: any) => (
                  <tr key={tx.id}>
                    <td className="py-2.5 pr-3 font-mono-num">{tx.reference}</td>
                    <td className="py-2.5 pr-3">{tx.counterpartyName}</td>
                    <td className="py-2.5 pr-3">{tx.type}</td>
                    <td className="py-2.5 pr-3 font-mono-num font-semibold">{formatMoney(tx.amount, tx.currency)}</td>
                    <td className="py-2.5 pr-3">
                      <SemanticStateLabel state={tx.status} />
                    </td>
                    <td className="py-2.5">
                      {tx.status !== 'REVERSED' && tx.type !== 'REVERSAL' && (
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/admin/transactions/${tx.id}/reverse`, {
                              method: 'POST',
                              body: JSON.stringify({ reason: 'Admin ledger correction' }),
                            });
                            await loadAdmin();
                            showToast(t('admin.postReversal'), 'success');
                          }}
                          className="text-xs font-semibold text-[#EA580C] dark:text-[#FB923C] hover:underline"
                        >
                          {t('admin.postReversal')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SurfaceCard>
        </div>
      )}

      {adminData && tab === 'compliance' && (
        <div className="space-y-6">
          <SurfaceCard className="p-5 space-y-3">
            <h2 className="text-sm font-display font-bold flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-[#F97316]" />
              <span>{t('admin.verifQueueTitle')}</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(adminData.verifications || []).map((v: any) => (
                <div
                  key={v.id}
                  className="p-3.5 rounded-xl border border-slate-200/80 dark:border-white/[0.06] flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 dark:text-white truncate">
                      {v.subjectName || v.userId} · <span className="text-[#EA580C]">{v.verificationType}</span>
                    </div>
                    <div className="text-slate-600 dark:text-zinc-400 font-mono-num truncate mt-0.5">
                      {v.documentNumber || v.addressFull || v.phoneNumber}
                      {v.city ? ` (${v.city})` : ''}
                      {v.issuingCountry ? ` · ${v.issuingCountry}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <SemanticStateLabel state={v.status} />
                    {v.status !== 'VERIFIED' && (
                      <SecondaryButton
                        onClick={async () => {
                          await apiFetch(`/api/admin/verifications/${v.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: 'VERIFIED' }),
                          });
                          await loadAdmin();
                          showToast(t('admin.approve'), 'success');
                        }}
                        className="!min-h-[30px] !py-1 !px-2.5 text-[11px]"
                      >
                        {t('admin.approve')}
                      </SecondaryButton>
                    )}
                    {v.status === 'PENDING' && (
                      <SecondaryButton
                        onClick={async () => {
                          await apiFetch(`/api/admin/verifications/${v.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: 'REJECTED', rejectionReason: 'Compliance mismatch' }),
                          });
                          await loadAdmin();
                          showToast(t('admin.rejectAccount'), 'info');
                        }}
                        className="!min-h-[30px] !py-1 !px-2.5 text-[11px] !text-red-600"
                      >
                        {t('admin.rejectAccount')}
                      </SecondaryButton>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </SurfaceCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SurfaceCard className="p-5 space-y-3">
              <h2 className="text-sm font-display font-bold">{t('admin.kycQueue')}</h2>
              {adminData.kycRecords.map((k: any) => (
                <div key={k.id} className="p-3.5 rounded-xl border border-slate-200/80 dark:border-white/[0.06] flex items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-semibold">
                      {k.subject_name} ({k.record_type})
                    </div>
                    <div className="text-slate-500">
                      {k.document_type} · *{k.document_last4} · Risk {k.risk_score}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <SemanticStateLabel state={k.status} />
                    {k.status !== 'VERIFIED' && (
                      <SecondaryButton
                        onClick={async () => {
                          await apiFetch(`/api/admin/kyc/${k.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'VERIFIED' }) });
                          await loadAdmin();
                          showToast(t('admin.approve'), 'success');
                        }}
                        className="!min-h-[32px] !py-1 !px-2.5 text-xs"
                      >
                        {t('admin.approve')}
                      </SecondaryButton>
                    )}
                  </div>
                </div>
              ))}
            </SurfaceCard>

          <SurfaceCard className="p-5 space-y-3">
            <h2 className="text-sm font-display font-bold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
              <span>{t('admin.amlCases')}</span>
            </h2>
            {adminData.amlCases.map((c: any) => (
              <div key={c.id} className="p-3.5 rounded-xl border border-slate-200/80 dark:border-white/[0.06] space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold">
                    {c.case_type} · {c.severity} (Score {c.risk_score})
                  </span>
                  <SemanticStateLabel state={c.status} />
                </div>
                <p className="text-slate-500">{c.reason}</p>
                {c.status === 'OPEN' && (
                  <div className="flex gap-2 pt-1">
                    <SecondaryButton
                      onClick={async () => {
                        await apiFetch(`/api/admin/aml/${c.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'CLEARED' }) });
                        await loadAdmin();
                        showToast(t('admin.clearCase'), 'success');
                      }}
                      className="!min-h-[32px] !py-1 !px-3 text-xs"
                    >
                      {t('admin.clearCase')}
                    </SecondaryButton>
                    <SecondaryButton
                      onClick={async () => {
                        await apiFetch(`/api/admin/aml/${c.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ESCALATED' }) });
                        await loadAdmin();
                      }}
                      className="!min-h-[32px] !py-1 !px-3 text-xs !text-red-500"
                    >
                      {t('admin.escalate')}
                    </SecondaryButton>
                  </div>
                )}
              </div>
            ))}
          </SurfaceCard>
          </div>
        </div>
      )}

      {adminData && tab === 'cards_pos' && (
        <div className="space-y-6">
          <SurfaceCard className="p-5 space-y-4">
            <h2 className="text-sm font-display font-bold flex items-center gap-2">
              <Store className="w-4 h-4 text-[#F97316]" />
              <span>{t('admin.posApprovalsTitle')}</span>
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {(adminData.terminals || []).map((pt: any) => {
                const mode = posModeMap[pt.id] || pt.terminalMode || 'HYBRID';
                const floor = posFloorMap[pt.id] ?? String(pt.offlineFloorLimit ?? 2500);
                return (
                  <div
                    key={pt.id}
                    className="p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] space-y-3 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                          {pt.serialNumber} · {pt.model}
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          {pt.ownerName || pt.merchantId} · {pt.locationName}
                        </div>
                      </div>
                      <SemanticStateLabel state={pt.approvalStatus || 'APPROVED'} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">POS Modu</label>
                        <select
                          value={mode}
                          onChange={(e) => setPosModeMap((p) => ({ ...p, [pt.id]: e.target.value as any }))}
                          className="w-full min-h-[34px] px-2 rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs font-semibold"
                        >
                          <option value="ONLINE">ONLINE</option>
                          <option value="OFFLINE">OFFLINE</option>
                          <option value="HYBRID">HYBRID (Online+Offline)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">Offline Limit</label>
                        <input
                          type="number"
                          min="0"
                          value={floor}
                          onChange={(e) => setPosFloorMap((p) => ({ ...p, [pt.id]: e.target.value }))}
                          className="w-full min-h-[34px] px-2 rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] font-mono-num text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="font-mono-num text-[11px] text-slate-500">
                        Online={pt.onlineEnabled ? 'ON' : 'OFF'} · Offline={pt.offlineEnabled ? 'ON' : 'OFF'} · Queue={pt.offlineQueuedCount}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <SecondaryButton
                          onClick={() => handlePosDecision(pt, 'REJECTED')}
                          className="!min-h-[30px] !py-1 !px-2.5 text-[11px] !text-red-600"
                        >
                          {t('admin.rejectAccount')}
                        </SecondaryButton>
                        <PrimaryButton
                          onClick={() => handlePosDecision(pt, 'APPROVED')}
                          className="!min-h-[30px] !py-1 !px-2.5 text-[11px]"
                        >
                          {t('admin.approve')}
                        </PrimaryButton>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </SurfaceCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SurfaceCard className="p-5 space-y-3">
              <h2 className="text-sm font-display font-bold flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-[#EA580C]" />
                <span>{t('cards.title')}</span>
              </h2>
              {adminData.cards.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] text-xs">
                  <div>
                    <div className="font-semibold">
                      {c.scheme} {c.productType} · {c.maskedPan || `*${c.last4}`}
                    </div>
                    <div className="text-slate-500">
                      {c.holderName} · Limit {c.dailyLimit}
                    </div>
                  </div>
                  <SemanticStateLabel state={c.status} />
                </div>
              ))}
            </SurfaceCard>

            <SurfaceCard className="p-5 space-y-3">
              <h2 className="text-sm font-display font-bold">{t('settings.plansTab')}</h2>
              {data?.membershipPlans.map((plan) => (
                <div key={plan.tier} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] text-xs">
                  <div>
                    <div className="font-semibold">
                      {plan.tier} (€{plan.monthlyPriceEur}/mo)
                    </div>
                    <div className="text-slate-500">
                      €{plan.dailyTransferLimitEur.toLocaleString()} · FX {plan.fxMarkupBps} bps
                    </div>
                  </div>
                  <SecondaryButton
                    onClick={async () => {
                      await apiFetch(`/api/admin/memberships/${plan.tier}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ fxMarkupBps: Math.max(0, plan.fxMarkupBps - 5) }),
                      });
                      await loadAdmin();
                      showToast(`${plan.tier} -5 bps FX`, 'success');
                    }}
                    className="!min-h-[32px] !py-1 !px-2.5 text-xs"
                  >
                    -5 bps FX
                  </SecondaryButton>
                </div>
              ))}
            </SurfaceCard>
          </div>
        </div>
      )}

      {adminData && tab === 'providers_cloud' && (
        <div className="space-y-6">
          <SurfaceCard className="p-5 space-y-3">
            <h2 className="text-sm font-display font-bold flex items-center gap-2">
              <Database className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C]" />
              <span>{t('admin.tabProviders')}</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {adminData.providers.map((p: any) => (
                <div key={p.id} className="p-4 rounded-xl border border-slate-200/80 dark:border-white/[0.06] space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{p.name}</span>
                    <SemanticStateLabel state={p.status} />
                  </div>
                  <div className="text-slate-500">
                    {p.category} · {p.environment}
                  </div>
                  <p className="text-slate-600 dark:text-zinc-400">{p.details}</p>
                </div>
              ))}
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-5 space-y-3">
            <h2 className="text-sm font-display font-bold flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#F97316]" />
              <span>Tenants</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {adminData.tenants.map((ten: any) => (
                <div key={ten.id} className="p-4 rounded-xl bg-slate-50 dark:bg-white/[0.03] flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{ten.name}</div>
                    <div className="text-slate-500 font-mono-num">{ten.domain}</div>
                  </div>
                  <SemanticStateLabel state={ten.status} />
                </div>
              ))}
            </div>
          </SurfaceCard>
        </div>
      )}

      {adminData && tab === 'audit' && (
        <SurfaceCard className="p-5 space-y-3">
          <h2 className="text-sm font-display font-bold flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C]" />
            <span>{t('admin.tabAudit')}</span>
          </h2>
          <div className="space-y-2 text-xs">
            {adminData.auditLogs.map((a: any) => (
              <div key={a.id} className="p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="font-mono-num font-bold text-[#EA580C] dark:text-[#FB923C]">{a.action}</span>
                  <span className="mx-1.5 text-slate-400">·</span>
                  <span className="font-medium">{a.actor_email}</span>
                  <div className="text-slate-500 mt-0.5">{a.metadata}</div>
                </div>
                <div className="font-mono-num text-slate-400 shrink-0">{new Date(a.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </SurfaceCard>
      )}

      {/* Create Customer Modal */}
      <ModalSheet open={createUserOpen} onClose={() => setCreateUserOpen(false)} title={t('admin.createUser')}>
        <form onSubmit={handleCreateCustomer} className="space-y-3">
          <input
            type="text"
            required
            placeholder={t('auth.fullName')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
          />
          <input
            type="text"
            required
            placeholder={t('auth.phone')}
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
          />
          <input
            type="email"
            required
            placeholder={t('auth.email')}
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
          />
          <div className="grid grid-cols-2 gap-3">
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs"
            >
              <option value="INDIVIDUAL_CUSTOMER">{t('admin.filterPersonal')}</option>
              <option value="BUSINESS_MANAGER">{t('admin.filterBusiness')}</option>
              <option value="MERCHANT">{t('admin.filterMerchant')}</option>
              <option value="COMPLIANCE_OFFICER">Compliance Officer</option>
              <option value="FINANCE_ADMIN">Finance Admin</option>
            </select>
            <select
              value={newCurrency}
              onChange={(e) => setNewCurrency(e.target.value)}
              className="min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs"
            >
              {['TRY', 'EUR', 'USD', 'GBP'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <PrimaryButton type="submit" className="w-full">
            {t('accounts.createBtn')}
          </PrimaryButton>
        </form>
      </ModalSheet>

      {/* Pool Adjust Modal */}
      <ModalSheet
        open={Boolean(adjustPoolModal)}
        onClose={() => setAdjustPoolModal(null)}
        title={adjustPoolModal ? `Pool ${adjustPoolModal.code} — ${t('admin.poolAdjustTitle')}` : ''}
      >
        {adjustPoolModal && (
          <form onSubmit={handlePoolAdjust} className="space-y-3">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] text-xs flex items-center justify-between">
              <span className="font-semibold">{adjustPoolModal.name}</span>
              <span className="font-mono-num font-bold text-[#EA580C]">
                {formatMoney(adjustPoolModal.balance, adjustPoolModal.currency)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAdjustDirection('CREDIT')}
                className={`py-2 rounded-xl text-xs font-bold border ${
                  adjustDirection === 'CREDIT'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white dark:bg-[#18181D] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-white/10'
                }`}
              >
                {t('admin.poolCredit')}
              </button>
              <button
                type="button"
                onClick={() => setAdjustDirection('DEBIT')}
                className={`py-2 rounded-xl text-xs font-bold border ${
                  adjustDirection === 'DEBIT'
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-white dark:bg-[#18181D] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-white/10'
                }`}
              >
                {t('admin.poolDebit')}
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {t('transfers.amount')} ({adjustPoolModal.currency})
              </label>
              <input
                type="number"
                min="1"
                step="0.01"
                required
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
                className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Custodian / Saklama Durumu</label>
              <input
                type="text"
                value={adjustCustodian}
                onChange={(e) => setAdjustCustodian(e.target.value)}
                className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">İşlem Gerekçesi / Audit Reason</label>
              <input
                type="text"
                required
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
              />
            </div>
            <PrimaryButton type="submit" loading={savingPool} className="w-full">
              {t('transfers.authorizeBtn')}
            </PrimaryButton>
          </form>
        )}
      </ModalSheet>

      {/* New Partner Bank Pool Modal */}
      <ModalSheet open={newPoolOpen} onClose={() => setNewPoolOpen(false)} title={t('admin.addBankPoolTitle')}>
        <form onSubmit={handleCreatePool} className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Havuz Kodu</label>
              <input
                type="text"
                required
                maxLength={8}
                value={poolCode}
                onChange={(e) => setPoolCode(e.target.value.toUpperCase())}
                placeholder="H"
                className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs font-mono-num font-bold uppercase"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Para Birimi</label>
              <select
                value={poolCurrency}
                onChange={(e) => setPoolCurrency(e.target.value)}
                className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs font-semibold"
              >
                {['TRY', 'EUR', 'USD', 'GBP'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Yönlendirme</label>
              <select
                value={poolRoutingMode}
                onChange={(e) => setPoolRoutingMode(e.target.value as any)}
                className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs font-semibold"
              >
                <option value="ALL">ALL (Giriş + Çıkış)</option>
                <option value="INFLOW">INFLOW (Sadece Giriş)</option>
                <option value="OUTFLOW">OUTFLOW (Sadece Çıkış)</option>
                <option value="STANDBY">STANDBY</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Anlaşmalı Banka Adı</label>
            <input
              type="text"
              required
              value={poolBankName}
              onChange={(e) => setPoolBankName(e.target.value)}
              placeholder="Örn: Ziraat Bankası / Garanti BBVA / İş Bankası"
              className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Havuz Açıklaması</label>
            <input
              type="text"
              required
              value={poolName}
              onChange={(e) => setPoolName(e.target.value)}
              placeholder="Örn: Ana Takas & Giriş-Çıkış Havuzu"
              className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Banka Havuz IBAN</label>
              <input
                type="text"
                value={poolIban}
                onChange={(e) => setPoolIban(e.target.value.toUpperCase())}
                placeholder="TR33 0001 ..."
                className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs font-mono-num uppercase"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">BIC / SWIFT Kodu</label>
              <input
                type="text"
                value={poolBic}
                onChange={(e) => setPoolBic(e.target.value.toUpperCase())}
                placeholder="TCZBTR2AXXX"
                className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs font-mono-num uppercase"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Açılış Likidite Bakiyesi</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={poolInitBal}
              onChange={(e) => setPoolInitBal(e.target.value)}
              className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num font-bold"
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-zinc-300 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={poolSetPrimary}
              onChange={(e) => setPoolSetPrimary(e.target.checked)}
              className="rounded border-slate-300 text-[#F97316]"
            />
            <span>{t('admin.setAsPrimaryLabel')}</span>
          </label>

          <PrimaryButton type="submit" loading={savingPool} className="w-full">
            <Plus className="w-4 h-4" />
            <span>{t('admin.createBankPoolSubmit')}</span>
          </PrimaryButton>
        </form>
      </ModalSheet>
    </div>
  );
};
