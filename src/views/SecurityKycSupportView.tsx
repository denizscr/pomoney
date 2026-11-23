import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  Crown,
  Download,
  Eye,
  EyeOff,
  FileCheck2,
  Fingerprint,
  Globe,
  Headset,
  HelpCircle,
  IdCard,
  Key,
  Lock,
  LogOut,
  MapPin,
  MessageSquare,
  Moon,
  Plus,
  ScanFace,
  Send,
  Shield,
  SlidersHorizontal,
  Smartphone,
  Sun,
  User,
  UserCheck,
} from 'lucide-react';
import {
  ErrorBanner,
  PrimaryButton,
  SandboxNotice,
  SecondaryButton,
  SemanticStateLabel,
  SurfaceCard,
} from '../components/ui.tsx';
import { useBanking } from '../context/BankingContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { usePWAInstall } from '../hooks/usePWA.ts';
import { SUPPORTED_LANGUAGES } from '../i18n/translations.ts';
import type { SessionRecord } from '../shared/types.ts';

type SettingsTab = 'profile' | 'security' | 'memberships' | 'api';

export const SecurityKycSupportView: React.FC<{ section: 'security' | 'support' | 'settings' }> = ({ section }) => {
  const {
    data,
    apiFetch,
    refreshData,
    showToast,
    realtimeConnected,
    theme,
    toggleTheme,
    hideBalances,
    toggleHideBalances,
    logout,
  } = useBanking();
  const { lang, deviceLocale, t } = useLanguage();
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const user = data?.user;

  const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile');
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [country, setCountry] = useState(user?.country || '');
  const [sessions, setSessions] = useState<SessionRecord[]>([]);

  // 4-Pillar Verification State
  const [verifTab, setVerifTab] = useState<'IDENTITY_CARD' | 'PASSPORT' | 'ADDRESS' | 'PHONE'>('IDENTITY_CARD');
  const [idNumber, setIdNumber] = useState(user?.nationalIdNumber || '');
  const [passportNumber, setPassportNumber] = useState(user?.passportNumber || '');
  const [issuingCountry, setIssuingCountry] = useState(user?.country || 'TR');
  const [expiryDate, setExpiryDate] = useState('2032-12-31');
  const [addressFull, setAddressFull] = useState(user?.addressLine || '');
  const [cityInput, setCityInput] = useState(user?.city || '');
  const [postalInput, setPostalInput] = useState(user?.postalCode || '');
  const [proofRef, setProofRef] = useState('');
  const [otpPhone, setOtpPhone] = useState(user?.phone || '');
  const [otpChallenge, setOtpChallenge] = useState<{ challengeId: string; phoneNumber: string; sandboxOtpCode: string } | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [submittingVerif, setSubmittingVerif] = useState(false);

  const [ticketSubj, setTicketSubj] = useState('');
  const [ticketMsg, setTicketMsg] = useState('');
  const [liveInput, setLiveInput] = useState('');
  const [sendingLive, setSendingLive] = useState(false);
  const liveScrollRef = useRef<HTMLDivElement | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [newKeyLabel, setNewKeyLabel] = useState('Production Sandbox Client');
  const [createdKeySecret, setCreatedKeySecret] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [pushPerm, setPushPerm] = useState<string>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'default';
  });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setFullName(user.fullName);
      setPhone(user.phone);
      setCountry(user.country);
      if (!idNumber && user.nationalIdNumber) setIdNumber(user.nationalIdNumber);
      if (!passportNumber && user.passportNumber) setPassportNumber(user.passportNumber);
      if (!addressFull && user.addressLine) setAddressFull(user.addressLine);
      if (!cityInput && user.city) setCityInput(user.city);
      if (!postalInput && user.postalCode) setPostalInput(user.postalCode);
      if (!otpPhone && user.phone) setOtpPhone(user.phone);
    }
  }, [user]);

  useEffect(() => {
    if (section === 'security' || section === 'settings') {
      apiFetch<SessionRecord[]>('/api/auth/sessions')
        .then(setSessions)
        .catch(() => undefined);
    }
  }, [section, apiFetch]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSavingProfile(true);
    try {
      await apiFetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ fullName, phone, country }),
      });
      await refreshData();
      showToast(t('settings.saveProfile'), 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleToggleHighValueAlerts = async () => {
    setErr(null);
    setSavingPrefs(true);
    const nextEnabled = !(user?.highValueAlertsEnabled ?? true);
    try {
      if (nextEnabled && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        try {
          const perm = await Notification.requestPermission();
          setPushPerm(perm);
        } catch {
          // Ignore browser permission error in embedded iframe
        }
      }
      await apiFetch('/api/settings/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ highValueAlertsEnabled: nextEnabled }),
      });
      await refreshData();
      showToast(t('settings.highValueAlerts'), 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleThresholdChange = async (threshold: number) => {
    setErr(null);
    setSavingPrefs(true);
    try {
      await apiFetch('/api/settings/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ highValueAlertThreshold: threshold }),
      });
      await refreshData();
      showToast(`${t('settings.alertThreshold')}: ${threshold.toLocaleString()}`, 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleToggleBiometric = async () => {
    setErr(null);
    setSavingPrefs(true);
    try {
      await apiFetch('/api/auth/biometric/toggle', { method: 'POST' });
      await refreshData();
      showToast(t('settings.biometricTitle'), 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleSubmitVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmittingVerif(true);
    try {
      const payload =
        verifTab === 'IDENTITY_CARD'
          ? {
              verificationType: 'IDENTITY_CARD',
              documentNumber: idNumber,
              issuingCountry,
              expiryDate,
              proofReference: proofRef || 'TC-KIMLIK-DOC',
            }
          : verifTab === 'PASSPORT'
          ? {
              verificationType: 'PASSPORT',
              documentNumber: passportNumber,
              issuingCountry,
              expiryDate,
              proofReference: proofRef || 'PASSPORT-MRZ',
            }
          : {
              verificationType: 'ADDRESS',
              addressFull,
              city: cityInput,
              postalCode: postalInput,
              issuingCountry,
              proofReference: proofRef || 'IKAMETGAH-FATURA',
            };
      await apiFetch('/api/verifications/submit', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setProofRef('');
      await refreshData();
      showToast(t('verif.submitDoc'), 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSubmittingVerif(false);
    }
  };

  const handleSendPhoneOtp = async () => {
    setErr(null);
    setSubmittingVerif(true);
    try {
      const res = await apiFetch<{ challengeId: string; phoneNumber: string; sandboxOtpCode: string }>(
        '/api/verifications/phone/send-otp',
        {
          method: 'POST',
          body: JSON.stringify({ phoneNumber: otpPhone }),
        }
      );
      setOtpChallenge(res);
      setOtpInput('');
      showToast(t('verif.sendOtp'), 'info');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSubmittingVerif(false);
    }
  };

  const handleVerifyPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpChallenge) return;
    setErr(null);
    setSubmittingVerif(true);
    try {
      await apiFetch('/api/verifications/phone/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ challengeId: otpChallenge.challengeId, code: otpInput }),
      });
      setOtpChallenge(null);
      setOtpInput('');
      await refreshData();
      showToast(t('verif.verified'), 'success');
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSubmittingVerif(false);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/tickets', {
        method: 'POST',
        body: JSON.stringify({ subject: ticketSubj, category: 'Account', message: ticketMsg }),
      });
      setTicketSubj('');
      setTicketMsg('');
      await refreshData();
      showToast(t('ui.sendSupportBtn'), 'success');
    } catch (error: any) {
      setErr(error.message);
    }
  };

  const handleReplyTicket = async (ticketId: string) => {
    const message = (replyText[ticketId] || '').trim();
    if (!message) return;
    await apiFetch(`/api/tickets/${ticketId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    setReplyText((prev) => ({ ...prev, [ticketId]: '' }));
    await refreshData();
  };

  const activeLiveChat = data?.tickets.find((tk) => tk.channel === 'LIVE_CHAT' && tk.status !== 'RESOLVED');

  useEffect(() => {
    if (section === 'support' && liveScrollRef.current) {
      liveScrollRef.current.scrollTop = liveScrollRef.current.scrollHeight;
    }
  }, [section, activeLiveChat?.messages.length]);

  const handleSendLiveChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = liveInput.trim();
    if (!message) return;
    setSendingLive(true);
    setErr(null);
    try {
      await apiFetch('/api/support/live-chat', {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      setLiveInput('');
      await refreshData();
    } catch (error: any) {
      setErr(error.message);
    } finally {
      setSendingLive(false);
    }
  };

  const renderSecurityPanels = () => (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <SurfaceCard className="lg:col-span-6 p-5 sm:p-6 space-y-5">
        <div className="pb-3 border-b border-slate-100 dark:border-white/[0.08]">
          <h2 className="text-sm font-display font-bold flex items-center gap-2 text-slate-900 dark:text-white">
            <Shield className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C]" />
            <span>{t('ui.accountSecurity')}</span>
          </h2>
          <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">{t('nav.security')}</p>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-white/[0.06] border border-slate-200/80 dark:border-white/[0.08] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between gap-3 p-4 bg-white dark:bg-white/[0.02]">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">{t('ui.mfaAuth')}</div>
              <div className="text-xs text-slate-600 dark:text-zinc-400">
                {user?.mfaEnabled ? t('overview.mfaActive') : t('overview.mfaRec')}
              </div>
            </div>
            <SecondaryButton
              onClick={async () => {
                await apiFetch('/api/auth/mfa/toggle', { method: 'POST' });
                await refreshData();
                showToast('2FA', 'success');
              }}
              className="!min-h-[38px] text-xs"
            >
              <Lock className="w-3.5 h-3.5 text-[#EA580C]" />
              <span>{user?.mfaEnabled ? 'OFF' : 'ON'}</span>
            </SecondaryButton>
          </div>

          <div className="flex items-center justify-between gap-3 p-4 bg-white dark:bg-white/[0.02]">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                <ScanFace className="w-4 h-4 text-[#EA580C] shrink-0" />
                <span>{t('settings.biometricTitle')}</span>
              </div>
              <div className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">
                {user?.biometricEnabled ? t('settings.biometricOn') : t('settings.biometricOff')} · {t('settings.biometricDesc')}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(user?.biometricEnabled)}
              disabled={savingPrefs}
              onClick={handleToggleBiometric}
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${
                user?.biometricEnabled ? 'bg-[#F97316]' : 'bg-slate-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  user?.biometricEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 p-4 bg-white dark:bg-white/[0.02]">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">{t('ui.passkeys')}</div>
              <div className="text-xs text-slate-600 dark:text-zinc-400">{user?.passkeyCount || 0} Passkey</div>
            </div>
            <SecondaryButton
              onClick={async () => {
                await apiFetch('/api/auth/passkeys/register', { method: 'POST' });
                await refreshData();
                showToast('Passkey', 'success');
              }}
              className="!min-h-[38px] text-xs"
            >
              <Fingerprint className="w-3.5 h-3.5 text-[#EA580C]" />
              <span>+ Passkey</span>
            </SecondaryButton>
          </div>
        </div>

        <div className="space-y-2.5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            {t('ui.activeSessions')} ({sessions.length})
          </h3>
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-2 text-xs p-3 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-slate-50/70 dark:bg-white/[0.02]"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-white truncate">
                    {s.deviceLabel} {s.isCurrent ? '· Current' : ''}
                  </div>
                  <div className="text-slate-600 dark:text-zinc-400 font-mono-num mt-0.5">
                    IP {s.ipAddress} · {new Date(s.lastActiveAt).toLocaleTimeString()}
                  </div>
                </div>
                {!s.isCurrent && (
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/auth/sessions/${s.id}/revoke`, { method: 'POST' });
                      setSessions((prev) => prev.filter((x) => x.id !== s.id));
                      showToast(t('ui.revoke'), 'info');
                    }}
                    className="text-red-600 font-semibold hover:underline shrink-0"
                  >
                    {t('ui.revoke')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="lg:col-span-6 p-5 sm:p-6 space-y-5">
        <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100 dark:border-white/[0.08]">
          <div>
            <h2 className="text-sm font-display font-bold flex items-center gap-2 text-slate-900 dark:text-white">
              <UserCheck className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C]" />
              <span>{t('verif.hubTitle')}</span>
            </h2>
            <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">{t('verif.hubDesc')}</p>
          </div>
          <SemanticStateLabel state={user?.kycStatus || 'UNVERIFIED'} />
        </div>

        {/* 4-Pillar Status Overview Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(
            [
              { id: 'IDENTITY_CARD', label: t('verif.identityCard'), ok: user?.identityVerified, icon: IdCard },
              { id: 'PASSPORT', label: t('verif.passport'), ok: user?.passportVerified, icon: FileCheck2 },
              { id: 'ADDRESS', label: t('verif.address'), ok: user?.addressVerified, icon: MapPin },
              { id: 'PHONE', label: t('verif.phone'), ok: user?.phoneVerified, icon: Smartphone },
            ] as const
          ).map((pillar) => {
            const Icon = pillar.icon;
            const active = verifTab === pillar.id;
            const pendingRow = data?.verifications?.find(
              (v) => v.verificationType === pillar.id && v.status === 'PENDING'
            );
            return (
              <button
                key={pillar.id}
                type="button"
                onClick={() => setVerifTab(pillar.id)}
                className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between gap-2 ${
                  active
                    ? 'border-[#F97316] bg-orange-50/70 dark:bg-orange-500/15'
                    : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] hover:border-orange-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Icon className={`w-4 h-4 ${active ? 'text-[#EA580C]' : 'text-slate-500 dark:text-zinc-400'}`} />
                  <span
                    className={`w-2 h-2 rounded-full ${
                      pillar.ok ? 'bg-emerald-500' : pendingRow ? 'bg-amber-500' : 'bg-slate-300 dark:bg-zinc-600'
                    }`}
                  />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-slate-900 dark:text-white leading-tight line-clamp-2">
                    {pillar.label}
                  </div>
                  <div
                    className={`text-[10px] font-semibold mt-0.5 ${
                      pillar.ok
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : pendingRow
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-slate-500 dark:text-zinc-400'
                    }`}
                  >
                    {pillar.ok ? t('verif.verified') : pendingRow ? t('verif.pending') : t('verif.unverified')}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Active Pillar Form */}
        {verifTab === 'PHONE' ? (
          <div className="space-y-4 p-4 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/[0.02]">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="tel"
                value={otpPhone}
                onChange={(e) => setOtpPhone(e.target.value)}
                placeholder="+90 5XX XXX XX XX"
                className="flex-1 min-h-[42px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
              />
              <SecondaryButton onClick={handleSendPhoneOtp} disabled={submittingVerif}>
                <Smartphone className="w-4 h-4 text-[#EA580C]" />
                <span>{t('verif.sendOtp')}</span>
              </SecondaryButton>
            </div>

            {otpChallenge && (
              <form onSubmit={handleVerifyPhoneOtp} className="space-y-3 pt-2 border-t border-slate-200 dark:border-white/10">
                <div className="p-3 rounded-xl bg-orange-50 border border-orange-200 dark:bg-orange-500/15 dark:border-orange-500/30 text-xs flex items-center justify-between">
                  <span className="font-semibold text-orange-900 dark:text-orange-200">
                    {t('verif.sandboxSmsNotice')}:
                  </span>
                  <span className="font-mono-num font-bold text-base tracking-widest text-[#EA580C] dark:text-orange-300">
                    {otpChallenge.sandboxOtpCode}
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={6}
                    required
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                    placeholder={t('verif.otpPlaceholder')}
                    className="flex-1 min-h-[42px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num tracking-widest"
                  />
                  <PrimaryButton type="submit" loading={submittingVerif}>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{t('verif.verifyOtp')}</span>
                  </PrimaryButton>
                </div>
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmitVerification} className="space-y-3 p-4 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/[0.02]">
            {verifTab === 'IDENTITY_CARD' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                    {t('verif.nationalIdNo')}
                  </label>
                  <input
                    type="text"
                    required
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                    placeholder="24681357902"
                    className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                    {t('verif.issuingCountry')}
                  </label>
                  <input
                    type="text"
                    maxLength={2}
                    value={issuingCountry}
                    onChange={(e) => setIssuingCountry(e.target.value.toUpperCase())}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                    {t('verif.expiryDate')}
                  </label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
                  />
                </div>
              </div>
            )}

            {verifTab === 'PASSPORT' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                    {t('verif.passportNo')}
                  </label>
                  <input
                    type="text"
                    required
                    value={passportNumber}
                    onChange={(e) => setPassportNumber(e.target.value.toUpperCase())}
                    placeholder="U24908142"
                    className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                    {t('verif.issuingCountry')}
                  </label>
                  <input
                    type="text"
                    maxLength={2}
                    value={issuingCountry}
                    onChange={(e) => setIssuingCountry(e.target.value.toUpperCase())}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                    {t('verif.expiryDate')}
                  </label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
                  />
                </div>
              </div>
            )}

            {verifTab === 'ADDRESS' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                    {t('verif.addressFull')}
                  </label>
                  <input
                    type="text"
                    required
                    value={addressFull}
                    onChange={(e) => setAddressFull(e.target.value)}
                    placeholder="Abdi İpekçi Cad. No:42 D:8, Nişantaşı"
                    className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                    {t('verif.city')}
                  </label>
                  <input
                    type="text"
                    required
                    value={cityInput}
                    onChange={(e) => setCityInput(e.target.value)}
                    placeholder="İstanbul"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                    {t('verif.postalCode')}
                  </label>
                  <input
                    type="text"
                    value={postalInput}
                    onChange={(e) => setPostalInput(e.target.value)}
                    placeholder="34367"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                {t('verif.proofRef')}
              </label>
              <input
                type="text"
                value={proofRef}
                onChange={(e) => setProofRef(e.target.value)}
                placeholder="e-Devlet / Barkod No / MRZ"
                className="w-full min-h-[40px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-xs font-mono-num"
              />
            </div>

            <PrimaryButton type="submit" loading={submittingVerif} className="w-full">
              {t('verif.submitDoc')}
            </PrimaryButton>
          </form>
        )}

        {/* Verification Submission History */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            {t('verif.historyTitle')} ({data?.verifications?.length || 0})
          </h3>
          {!data?.verifications || data.verifications.length === 0 ? (
            <div className="text-xs text-slate-500 py-2">{t('verif.noHistory')}</div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {data.verifications.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 dark:text-white">{v.verificationType}</div>
                    <div className="text-slate-600 dark:text-zinc-400 font-mono-num truncate">
                      {v.documentNumber || v.addressFull || v.phoneNumber || v.proofReference}
                      {v.city ? ` · ${v.city}` : ''}
                    </div>
                  </div>
                  <SemanticStateLabel state={v.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </SurfaceCard>
    </div>
  );

  if (section === 'security') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
            {t('security.title')}
          </h1>
        </div>
        <ErrorBanner message={err} onDismiss={() => setErr(null)} />
        {renderSecurityPanels()}
      </div>
    );
  }

  if (section === 'support') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
              {t('support.liveTitle')}
            </h1>
            <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">{t('support.liveDesc')}</p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border ${
              realtimeConnected
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${realtimeConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
            <span>{realtimeConnected ? 'WebSocket Canlı Hat Aktif' : 'Yeniden Bağlanıyor...'}</span>
          </span>
        </div>

        <ErrorBanner message={err} onDismiss={() => setErr(null)} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Live Support Hotline Instant Chat */}
          <SurfaceCard className="lg:col-span-6 p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-white/[0.08]">
              <h2 className="text-sm font-display font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                <Headset className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C]" />
                <span>{t('support.liveChatHeader')}</span>
              </h2>
              {activeLiveChat && <SemanticStateLabel state={activeLiveChat.status} />}
            </div>

            <div
              ref={liveScrollRef}
              className="h-72 overflow-y-auto space-y-2.5 p-3 rounded-2xl bg-slate-50/90 dark:bg-white/[0.02] border border-slate-200/80 dark:border-white/[0.08]"
            >
              {activeLiveChat && activeLiveChat.messages.length > 0 ? (
                activeLiveChat.messages.map((m) => {
                  const isMine = m.senderId === user?.id;
                  return (
                    <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs shadow-sm ${
                          isMine
                            ? 'bg-[#F97316] text-white'
                            : 'bg-white dark:bg-[#18181D] text-slate-800 dark:text-zinc-200 border border-slate-200 dark:border-white/10'
                        }`}
                      >
                        <div className={`text-[10px] font-bold mb-0.5 ${isMine ? 'text-orange-100' : 'text-[#EA580C]'}`}>
                          {m.senderName} · {new Date(m.createdAt).toLocaleTimeString()}
                        </div>
                        <p className="leading-relaxed">{m.message}</p>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center text-xs text-slate-500 dark:text-zinc-400 px-4">
                  <Headset className="w-8 h-8 text-[#F97316]/60 mb-2" />
                  <p>{t('support.liveEmpty')}</p>
                </div>
              )}
            </div>

            <form onSubmit={handleSendLiveChat} className="flex gap-2">
              <input
                type="text"
                required
                value={liveInput}
                onChange={(e) => setLiveInput(e.target.value)}
                placeholder={t('support.livePlaceholder')}
                className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
              />
              <PrimaryButton type="submit" loading={sendingLive} className="!min-h-[44px] px-4">
                <Send className="w-4 h-4" />
                <span>{t('support.sendBtn')}</span>
              </PrimaryButton>
            </form>
          </SurfaceCard>

          {/* Formal Support Ticket Form + History */}
          <div className="lg:col-span-6 space-y-4">
            <SurfaceCard className="p-5 sm:p-6 space-y-4">
              <h2 className="text-sm font-display font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                <HelpCircle className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C]" />
                <span>{t('support.title')}</span>
              </h2>
              <form onSubmit={handleCreateTicket} className="space-y-3">
                <input
                  type="text"
                  required
                  placeholder="Konu / Subject"
                  value={ticketSubj}
                  onChange={(e) => setTicketSubj(e.target.value)}
                  className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
                />
                <textarea
                  rows={3}
                  required
                  placeholder={t('support.livePlaceholder')}
                  value={ticketMsg}
                  onChange={(e) => setTicketMsg(e.target.value)}
                  className="w-full p-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
                />
                <PrimaryButton type="submit" className="w-full">
                  <MessageSquare className="w-4 h-4" />
                  <span>{t('ui.sendSupportBtn')}</span>
                </PrimaryButton>
              </form>
            </SurfaceCard>

            {data?.tickets.map((tk) => (
              <SurfaceCard key={tk.id} className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">{tk.subject}</div>
                    <div className="text-xs text-slate-600 dark:text-zinc-400">
                      {tk.channel || 'TICKET'} · {tk.category} · {new Date(tk.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <SemanticStateLabel state={tk.status} />
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto pt-2 border-t border-slate-100 dark:border-white/[0.06]">
                  {tk.messages.map((m) => (
                    <div key={m.id} className="p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] text-xs">
                      <div className="font-bold text-[#EA580C] dark:text-[#FB923C]">
                        {m.senderName}{' '}
                        <span className="text-slate-500 dark:text-zinc-400 font-normal">({m.senderRole})</span>
                      </div>
                      <p className="mt-1 text-slate-700 dark:text-zinc-300">{m.message}</p>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={replyText[tk.id] || ''}
                    onChange={(e) => setReplyText((p) => ({ ...p, [tk.id]: e.target.value }))}
                    placeholder={t('support.livePlaceholder')}
                    className="flex-1 min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-xs"
                  />
                  <SecondaryButton onClick={() => handleReplyTicket(tk.id)} className="!min-h-[40px] text-xs">
                    {t('ui.reply')}
                  </SecondaryButton>
                </div>
              </SurfaceCard>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
            {t('settings.title')}
          </h1>
          <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">{t('settings.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {!isInstalled && isInstallable && (
            <PrimaryButton onClick={install}>
              <Download className="w-4 h-4" />
              <span>{t('common.installApp')}</span>
            </PrimaryButton>
          )}
          <SecondaryButton onClick={logout} className="!text-red-600 hover:!bg-red-50 hover:!border-red-200">
            <LogOut className="w-4 h-4" />
            <span>{t('common.signOut')}</span>
          </SecondaryButton>
        </div>
      </div>

      {/* Account Identity Banner Card */}
      <SurfaceCard className="p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#FF6B00] to-[#EA580C] text-white flex items-center justify-center text-lg font-display font-bold shrink-0 shadow-sm">
              {user?.fullName?.slice(0, 2).toUpperCase() || 'PM'}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-display font-bold text-slate-900 dark:text-white truncate">
                  {user?.fullName}
                </h2>
                <span className="text-xs font-mono-num font-bold text-[#EA580C]">#{user?.customerNumber}</span>
                <SemanticStateLabel state={user?.kycStatus || 'UNVERIFIED'} />
              </div>
              <div className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5 truncate">
                {user?.email} · {user?.phone} · {user?.role}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 sm:gap-6 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-white/10 text-xs shrink-0">
            <div>
              <div className="text-slate-500 dark:text-zinc-400">{t('admin.colTier')}</div>
              <div className="font-bold text-[#EA580C] dark:text-[#FB923C] mt-0.5">{user?.membershipTier}</div>
            </div>
            <div>
              <div className="text-slate-500 dark:text-zinc-400">{t('admin.colMfa')}</div>
              <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                {user?.mfaEnabled ? 'ON' : 'OFF'}
              </div>
            </div>
            <div>
              <div className="text-slate-500 dark:text-zinc-400">{t('auth.accountType')}</div>
              <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                {user?.accountCategory}
              </div>
            </div>
          </div>
        </div>
      </SurfaceCard>

      {/* Structured Settings Navigation Bar */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#18181D] border border-slate-200 dark:border-white/10 overflow-x-auto">
        {[
          { id: 'profile', label: t('settings.profileTab'), icon: User },
          { id: 'security', label: t('settings.securityTab'), icon: Shield },
          { id: 'memberships', label: t('settings.plansTab'), icon: Crown },
          { id: 'api', label: t('settings.apiTab'), icon: Key },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSettingsTab(item.id as SettingsTab)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                settingsTab === item.id
                  ? 'bg-white dark:bg-[#09090B] text-[#EA580C] dark:text-[#FB923C] shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <ErrorBanner message={err} onDismiss={() => setErr(null)} />

      {settingsTab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 7 Cols */}
          <SurfaceCard className="lg:col-span-7 p-5 sm:p-6 space-y-5">
            <div className="pb-3 border-b border-slate-100 dark:border-white/[0.08]">
              <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white">{t('ui.personalDetails')}</h2>
            </div>
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                    {t('auth.fullName')}
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                    {t('ui.registeredEmail')}
                  </label>
                  <input
                    type="email"
                    disabled
                    value={user?.email || ''}
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] text-slate-500 dark:text-zinc-400 text-sm cursor-not-allowed"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                    {t('auth.phone')}
                  </label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                    {t('ui.countryIso')}
                  </label>
                  <input
                    type="text"
                    maxLength={2}
                    required
                    value={country}
                    onChange={(e) => setCountry(e.target.value.toUpperCase())}
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm uppercase font-mono-num"
                  />
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 dark:border-white/[0.08]">
                <PrimaryButton type="submit" loading={savingProfile}>
                  {t('settings.saveProfile')}
                </PrimaryButton>
              </div>
            </form>
          </SurfaceCard>

          {/* Right 5 Cols: Language, Theme, Privacy */}
          <SurfaceCard className="lg:col-span-5 p-5 sm:p-6 space-y-5">
            <div className="pb-3 border-b border-slate-100 dark:border-white/[0.08]">
              <h2 className="text-sm font-display font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                <SlidersHorizontal className="w-4 h-4 text-[#EA580C]" />
                <span>{t('settings.workspacePrefs')}</span>
              </h2>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-white/[0.06] border border-slate-200/80 dark:border-white/[0.08] rounded-xl overflow-hidden">
              {/* Auto-Detected Device Language */}
              <div className="flex items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Globe className="w-4 h-4 text-[#EA580C] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{t('common.language')}</div>
                    <div className="text-xs text-slate-500 dark:text-zinc-400">{t('settings.autoLanguageDesc')}</div>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-orange-50 dark:bg-orange-500/15 text-[#EA580C] dark:text-orange-300 text-xs font-mono-num font-bold shrink-0">
                  {(SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.short || lang.toUpperCase())} · {deviceLocale}
                </span>
              </div>

              {/* Desktop / Android APK / iOS App Packaging */}
              <div className="p-4 space-y-2 bg-slate-50/60 dark:bg-white/[0.02]">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-[#EA580C] shrink-0" />
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">{t('settings.appInstallTitle')}</span>
                  </div>
                  {!isInstalled && isInstallable && (
                    <PrimaryButton onClick={install} className="!min-h-[32px] !py-1 !px-3 text-xs">
                      <Download className="w-3.5 h-3.5" />
                      <span>{t('common.installApp')}</span>
                    </PrimaryButton>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">{t('settings.appInstallDesc')}</p>
              </div>

              <div className="flex items-center justify-between gap-3 p-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{t('settings.themeLabel')}</div>
                  <div className="text-xs text-slate-500 dark:text-zinc-400">
                    {theme === 'light' ? t('common.lightMode') : t('common.darkMode')}
                  </div>
                </div>
                <SecondaryButton onClick={toggleTheme} className="!min-h-[38px] text-xs">
                  {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-[#EA580C]" /> : <Moon className="w-3.5 h-3.5 text-[#EA580C]" />}
                  <span>{theme === 'dark' ? t('ui.switchToLight') : t('ui.switchToDark')}</span>
                </SecondaryButton>
              </div>

              <div className="flex items-center justify-between gap-3 p-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{t('settings.privacyMask')}</div>
                  <div className="text-xs text-slate-500 dark:text-zinc-400">
                    {hideBalances ? '••••••' : '123.45'}
                  </div>
                </div>
                <SecondaryButton onClick={toggleHideBalances} className="!min-h-[38px] text-xs">
                  {hideBalances ? <Eye className="w-3.5 h-3.5 text-[#EA580C]" /> : <EyeOff className="w-3.5 h-3.5 text-[#EA580C]" />}
                  <span>{hideBalances ? t('settings.show') : t('settings.hide')}</span>
                </SecondaryButton>
              </div>

              {/* High-Value Transaction Real-Time Push Notification Toggle */}
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Bell className="w-4 h-4 text-[#EA580C] shrink-0" />
                      <span>{t('settings.highValueAlerts')}</span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                      {t('settings.highValueAlertsDesc')}
                    </div>
                    <div className="text-[11px] font-mono-num text-slate-400 mt-0.5">
                      {pushPerm === 'granted'
                        ? t('settings.pushPermGranted')
                        : pushPerm === 'denied'
                        ? t('settings.pushPermDenied')
                        : t('settings.pushPermDefault')}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={user?.highValueAlertsEnabled ?? true}
                    disabled={savingPrefs}
                    onClick={handleToggleHighValueAlerts}
                    className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${
                      user?.highValueAlertsEnabled ?? true ? 'bg-[#F97316]' : 'bg-slate-300 dark:bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        user?.highValueAlertsEnabled ?? true ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                {(user?.highValueAlertsEnabled ?? true) && (
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-white/[0.06]">
                    <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">
                      {t('settings.alertThreshold')}
                    </span>
                    <div className="flex items-center gap-1">
                      {[1000, 5000, 10000, 25000].map((val) => {
                        const active = Number(user?.highValueAlertThreshold ?? 5000) === val;
                        return (
                          <button
                            key={val}
                            type="button"
                            disabled={savingPrefs}
                            onClick={() => handleThresholdChange(val)}
                            className={`px-2 py-1 rounded-lg text-[11px] font-mono-num font-bold border transition-colors ${
                              active
                                ? 'bg-[#F97316] text-white border-[#F97316]'
                                : 'bg-white dark:bg-[#18181D] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-white/10'
                            }`}
                          >
                            {val.toLocaleString()}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Biometric TouchID / FaceID Toggle */}
              <div className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <ScanFace className="w-4 h-4 text-[#EA580C] shrink-0" />
                    <span>{t('settings.biometricTitle')}</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                    {user?.biometricEnabled ? t('settings.biometricOn') : t('settings.biometricOff')}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(user?.biometricEnabled)}
                  disabled={savingPrefs}
                  onClick={handleToggleBiometric}
                  className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${
                    user?.biometricEnabled ? 'bg-[#F97316]' : 'bg-slate-300 dark:bg-zinc-700'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      user?.biometricEnabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 p-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{t('ui.accountSecurity')}</div>
                  <div className="text-xs text-slate-500 dark:text-zinc-400">
                    {user?.mfaEnabled ? '2FA ON' : '2FA OFF'} · {sessions.length}
                  </div>
                </div>
                <SecondaryButton onClick={() => setSettingsTab('security')} className="!min-h-[38px] text-xs">
                  <span>{t('overview.manage')}</span>
                </SecondaryButton>
              </div>
            </div>
          </SurfaceCard>
        </div>
      )}

      {settingsTab === 'security' && renderSecurityPanels()}

      {settingsTab === 'memberships' && (
        <SurfaceCard className="p-5 sm:p-6 space-y-5">
          <div className="pb-3 border-b border-slate-100 dark:border-white/[0.08]">
            <h2 className="text-base font-display font-bold text-slate-900 dark:text-white">{t('settings.plansTab')}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {data?.membershipPlans.map((plan) => {
              const isCurrent = plan.tier === user?.membershipTier;
              return (
                <div
                  key={plan.tier}
                  className={`p-5 rounded-2xl border flex flex-col justify-between space-y-4 ${
                    isCurrent
                      ? 'border-[#F97316] bg-orange-50/50 dark:bg-orange-500/[0.06] shadow-sm'
                      : 'border-slate-200 dark:border-white/10 bg-white dark:bg-transparent'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display font-bold text-sm text-slate-900 dark:text-white">{plan.tier}</span>
                      <span className="font-mono-num font-bold text-sm text-[#EA580C] dark:text-[#FB923C]">
                        €{plan.monthlyPriceEur}/mo
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.04] text-xs text-slate-700 dark:text-zinc-300 space-y-1">
                      <div className="flex justify-between">
                        <span>Daily Limit</span>
                        <span className="font-mono-num font-semibold">€{plan.dailyTransferLimitEur.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>FX Markup</span>
                        <span className="font-mono-num font-semibold">{plan.fxMarkupBps} bps</span>
                      </div>
                    </div>
                    <ul className="space-y-1.5 text-xs text-slate-700 dark:text-zinc-300">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#F97316] shrink-0 mt-0.5" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="pt-2 border-t border-slate-100 dark:border-white/10">
                    {isCurrent ? (
                      <div className="text-xs font-bold text-[#EA580C] dark:text-[#FB923C]">{t('ui.activeCurrentPlan')}</div>
                    ) : (
                      <div className="text-xs text-slate-500 dark:text-zinc-400">{t('ui.availableViaAdmin')}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SurfaceCard>
      )}

      {settingsTab === 'api' && (
        <SurfaceCard className="p-5 sm:p-6 space-y-5">
          <div className="pb-3 border-b border-slate-100 dark:border-white/[0.08]">
            <h2 className="text-sm font-display font-bold flex items-center gap-2 text-slate-900 dark:text-white">
              <Key className="w-4 h-4 text-[#EA580C] dark:text-[#FB923C]" />
              <span>{t('settings.apiTab')}</span>
            </h2>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={newKeyLabel}
              onChange={(e) => setNewKeyLabel(e.target.value)}
              className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
            />
            <PrimaryButton
              onClick={async () => {
                const res = await apiFetch<{ oneTimeKey: string }>('/api/developer/api-keys', {
                  method: 'POST',
                  body: JSON.stringify({ label: newKeyLabel }),
                });
                setCreatedKeySecret(res.oneTimeKey);
                await refreshData();
                showToast(t('ui.apiGenBtn'), 'success');
              }}
            >
              <Plus className="w-4 h-4" />
              <span>{t('ui.apiGenBtn')}</span>
            </PrimaryButton>
          </div>
          {createdKeySecret && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-200 text-xs font-mono-num break-all">
              {createdKeySecret}
            </div>
          )}
          <div className="divide-y divide-slate-100 dark:divide-white/[0.06] border border-slate-200 dark:border-white/[0.08] rounded-xl overflow-hidden">
            {data?.apiKeys.map((k) => (
              <div key={k.id} className="flex items-center justify-between p-3.5 bg-white dark:bg-white/[0.02] text-xs">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-white">{k.label}</div>
                  <div className="font-mono-num text-slate-500 dark:text-zinc-400 mt-0.5">
                    {k.keyPrefix}•••• · {k.environment}
                  </div>
                </div>
                <SemanticStateLabel state={k.status} />
              </div>
            ))}
          </div>
        </SurfaceCard>
      )}
    </div>
  );
};
