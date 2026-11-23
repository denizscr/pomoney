import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Headset,
  HelpCircle,
  KeyRound,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Store,
  User,
  UserPlus,
} from 'lucide-react';
import { useBanking } from '../context/BankingContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { ProMoneyLogo } from './ProMoneyLogo.tsx';
import { ErrorBanner, PrimaryButton, SecondaryButton } from './ui.tsx';

type LoginPortal = 'PERSONAL' | 'CORPORATE' | 'ADMIN';

function detectInitialPortal(): LoginPortal {
  if (typeof window === 'undefined') return 'PERSONAL';
  const h = window.location.hash.toLowerCase();
  const pathname = window.location.pathname.toLowerCase();
  const q = new URLSearchParams(window.location.search).get('portal')?.toLowerCase() || '';
  if (
    h.includes('yonetim-gizli-giris') ||
    pathname.includes('yonetim-gizli-giris') ||
    q === 'yonetim-gizli' ||
    h === '#admin' ||
    h === '#yonetim' ||
    q === 'admin' ||
    q === 'yonetim'
  ) {
    return 'ADMIN';
  }
  if (h.includes('kurumsal') || h.includes('sirket') || h.includes('business') || q === 'kurumsal' || q === 'corporate') {
    return 'CORPORATE';
  }
  return 'PERSONAL';
}

export const AuthScreens: React.FC = () => {
  const { loginWithCredentials, registerAccount, loading, showToast } = useBanking();
  const { t } = useLanguage();

  const [mode, setMode] = useState<'login' | 'register' | 'forgot_password' | 'forgot_username'>('login');
  const [loginPortal, setLoginPortal] = useState<LoginPortal>(detectInitialPortal);
  const [companyIdentifier, setCompanyIdentifier] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('TR');
  const [accountCategory, setAccountCategory] = useState<'Personal' | 'Business' | 'Merchant'>(() =>
    detectInitialPortal() === 'CORPORATE' ? 'Business' : 'Personal'
  );
  const [companyName, setCompanyName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [nationalIdNumber, setNationalIdNumber] = useState('');
  const [passportNumber, setPassportNumber] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');

  const [pendingReceipt, setPendingReceipt] = useState<{
    customerNumber: string;
    fullName: string;
    accountCategory: string;
  } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);

  // Account Lockout & Support Unlock Request State
  const [lockedInfo, setLockedInfo] = useState<{
    lockedUntil?: string | null;
    lockReason?: string | null;
    customerNumber?: string;
  } | null>(null);
  const [unlockNote, setUnlockNote] = useState('');
  const [unlockSending, setUnlockSending] = useState(false);
  const [unlockSentTicketId, setUnlockSentTicketId] = useState<string | null>(null);

  // Forgot Password State
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetPhone, setResetPhone] = useState('');
  const [resetChallenge, setResetChallenge] = useState<{
    challengeId: string;
    maskedPhone: string;
    maskedEmail: string;
    sandboxResetCode?: string;
  } | null>(null);
  const [resetCodeInput, setResetCodeInput] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  // Forgot Username / Customer Number State
  const [recoverFullName, setRecoverFullName] = useState('');
  const [recoverPhone, setRecoverPhone] = useState('');
  const [recoverCompany, setRecoverCompany] = useState('');
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [recoveredAccount, setRecoveredAccount] = useState<{
    customerNumber: string;
    maskedEmail: string;
    fullName: string;
    accountCategory: string;
  } | null>(null);

  useEffect(() => {
    const onUrlChange = () => {
      const next = detectInitialPortal();
      setLoginPortal(next);
    };
    window.addEventListener('hashchange', onUrlChange);
    window.addEventListener('popstate', onUrlChange);
    return () => {
      window.removeEventListener('hashchange', onUrlChange);
      window.removeEventListener('popstate', onUrlChange);
    };
  }, []);

  const switchPortal = (portal: LoginPortal) => {
    setLoginPortal(portal);
    setLocalError(null);
    setLockedInfo(null);
    setUnlockSentTicketId(null);
    if (portal === 'CORPORATE' && accountCategory === 'Personal') {
      setAccountCategory('Business');
    } else if (portal === 'PERSONAL' && accountCategory !== 'Personal') {
      setAccountCategory('Personal');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLockedInfo(null);
    setUnlockSentTicketId(null);
    try {
      if (mode === 'login') {
        await loginWithCredentials(identifier, password, {
          loginPortal,
          companyIdentifier: loginPortal === 'CORPORATE' ? companyIdentifier : undefined,
        });
      } else {
        const res = await registerAccount({
          email,
          password,
          fullName,
          phone,
          country,
          accountCategory,
          companyName: accountCategory !== 'Personal' ? companyName : undefined,
          taxId: accountCategory !== 'Personal' ? taxId : undefined,
          nationalIdNumber: nationalIdNumber || undefined,
          passportNumber: passportNumber || undefined,
          addressLine: addressLine || undefined,
          city: city || undefined,
          postalCode: postalCode || undefined,
        });
        setPendingReceipt({
          customerNumber: res.customerNumber,
          fullName: res.fullName,
          accountCategory: res.accountCategory,
        });
      }
    } catch (err: any) {
      if (err?.accountLocked) {
        setLockedInfo({
          lockedUntil: err.lockedUntil,
          lockReason: err.lockReason,
          customerNumber: err.customerNumber,
        });
        setLocalError(err.message || t('auth.lockedTitle'));
      } else if (err?.approvalStatus === 'PENDING_APPROVAL') {
        setLocalError(t('auth.pendingLoginErr'));
      } else if (err?.approvalStatus === 'REJECTED') {
        setLocalError(t('auth.rejectedLoginErr'));
      } else {
        setLocalError(err.message || 'Action failed');
      }
    }
  };

  const handleRequestUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return;
    setUnlockSending(true);
    try {
      const res = await fetch('/api/support/unlock-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: identifier.trim(),
          message:
            unlockNote.trim() ||
            'Hesabım hatalı şifre denemesi nedeniyle kilitlendi. Müşteri hizmetlerinden kilidin açılmasını rica ediyorum.',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Talep gönderilemedi.');
      setUnlockSentTicketId(json.ticketId);
      setUnlockNote('');
      showToast(t('auth.unlockSent'), 'success');
    } catch (err: any) {
      setLocalError(err.message);
    } finally {
      setUnlockSending(false);
    }
  };

  const handleRequestPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLocalSuccess(null);
    setLockedInfo(null);
    setResetLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: resetIdentifier.trim(),
          phone: resetPhone.trim(),
          loginPortal,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.accountLocked) {
          setLockedInfo({
            lockedUntil: json.lockedUntil,
            lockReason: json.lockReason,
            customerNumber: json.customerNumber,
          });
          setIdentifier(resetIdentifier.trim());
        }
        throw new Error(json.error || 'Şifre sıfırlama kodu oluşturulamadı.');
      }
      setResetChallenge({
        challengeId: json.challengeId,
        maskedPhone: json.maskedPhone,
        maskedEmail: json.maskedEmail,
        sandboxResetCode: json.sandboxResetCode,
      });
    } catch (err: any) {
      setLocalError(err.message);
    } finally {
      setResetLoading(false);
    }
  };

  const handleCompletePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (resetNewPassword !== resetConfirmPassword) {
      setLocalError(t('auth.passwordMismatchErr'));
      return;
    }
    if (!resetChallenge) return;
    setResetLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: resetChallenge.challengeId,
          code: resetCodeInput.trim(),
          newPassword: resetNewPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Şifre güncellenemedi.');
      setIdentifier(json.customerNumber || resetIdentifier.trim());
      setPassword('');
      setResetChallenge(null);
      setResetCodeInput('');
      setResetNewPassword('');
      setResetConfirmPassword('');
      setMode('login');
      setLocalSuccess(t('auth.passwordResetSuccess'));
      showToast(t('auth.passwordResetSuccess'), 'success');
    } catch (err: any) {
      setLocalError(err.message);
    } finally {
      setResetLoading(false);
    }
  };

  const handleRecoverUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setRecoveredAccount(null);
    setRecoverLoading(true);
    try {
      const res = await fetch('/api/auth/recover-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: recoverFullName.trim(),
          phone: recoverPhone.trim(),
          companyIdentifier: loginPortal === 'CORPORATE' ? recoverCompany.trim() : undefined,
          loginPortal,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Hesap bilgileri bulunamadı.');
      setRecoveredAccount({
        customerNumber: json.customerNumber,
        maskedEmail: json.maskedEmail,
        fullName: json.fullName,
        accountCategory: json.accountCategory,
      });
    } catch (err: any) {
      setLocalError(err.message);
    } finally {
      setRecoverLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#09090B] text-slate-900 dark:text-zinc-50 flex flex-col">
      {/* Top Tangerine Orange Bank Header — Clean, Auto-Detected Language */}
      <header className="h-16 px-4 sm:px-8 flex items-center justify-between bg-gradient-to-r from-[#FF6B00] via-[#F97316] to-[#EA580C] text-white shadow-sm">
        <ProMoneyLogo size="md" surface="orange" />
        <div className="text-[11px] font-semibold text-orange-50/90 flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" />
          <span>TLS 1.3 · WAF Protected</span>
        </div>
      </header>

      {/* Pure Centered Bank Portal Card with Side Action Menu (NO visible Admin login button) */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-4xl bg-white dark:bg-[#111115] rounded-3xl border border-slate-200/90 dark:border-white/10 shadow-[0_14px_42px_rgba(15,23,42,0.06)] overflow-hidden flex flex-col md:flex-row">
          {/* Side Action Menu: Sign In / Create Account ONLY */}
          <aside className="md:w-64 bg-slate-50/90 dark:bg-[#0D0D11] border-b md:border-b-0 md:border-r border-slate-200/90 dark:border-white/10 p-5 flex md:flex-col justify-between gap-4">
            <div className="space-y-4 w-full">
              <div className="hidden md:block">
                <div className="text-[11px] font-bold uppercase tracking-widest text-[#EA580C] dark:text-orange-400">
                  PRO MONEY
                </div>
                <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1 leading-relaxed">
                  {t('brand.tagline')}
                </p>
              </div>

              {loginPortal !== 'ADMIN' && (
                <div className="flex md:flex-col gap-2 w-full">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setPendingReceipt(null);
                      setLocalError(null);
                      setLocalSuccess(null);
                    }}
                    className={`flex-1 md:flex-none flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-xs font-bold transition-all text-left ${
                      mode === 'login' || mode === 'forgot_password' || mode === 'forgot_username'
                        ? 'bg-[#F97316] text-white shadow-sm'
                        : 'bg-white dark:bg-white/[0.04] text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-white/10 hover:border-orange-300'
                    }`}
                  >
                    <KeyRound className="w-4 h-4 shrink-0" />
                    <span>{t('auth.signInTab')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setPendingReceipt(null);
                      setLocalError(null);
                      setLocalSuccess(null);
                    }}
                    className={`flex-1 md:flex-none flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-xs font-bold transition-all text-left ${
                      mode === 'register'
                        ? 'bg-[#F97316] text-white shadow-sm'
                        : 'bg-white dark:bg-white/[0.04] text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-white/10 hover:border-orange-300'
                    }`}
                  >
                    <UserPlus className="w-4 h-4 shrink-0" />
                    <span>{t('auth.createAccountTab')}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="hidden md:flex flex-col gap-2 pt-3 border-t border-slate-200/80 dark:border-white/10 text-[11px] text-slate-500 dark:text-zinc-400">
              <p className="leading-relaxed">{t('auth.approvalNotice')}</p>
            </div>
          </aside>

          {/* Form Viewport */}
          <div className="flex-1 p-6 sm:p-8">
            {pendingReceipt ? (
              <div className="py-6 space-y-5 text-center">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
                  <Clock className="w-7 h-7" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-xl font-display font-bold text-slate-900 dark:text-white">
                    {t('auth.pendingTitle')}
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-zinc-400 max-w-md mx-auto leading-relaxed">
                    {t('auth.pendingDesc')}
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-orange-50/70 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30 max-w-sm mx-auto space-y-1">
                  <div className="text-[11px] font-semibold text-slate-600 dark:text-zinc-300">
                    {t('auth.customerNoLabel')}
                  </div>
                  <div className="text-2xl font-display font-bold font-mono-num text-[#EA580C] dark:text-[#FB923C]">
                    #{pendingReceipt.customerNumber}
                  </div>
                  <div className="text-xs text-slate-700 dark:text-zinc-300 font-medium">
                    {pendingReceipt.fullName} · {pendingReceipt.accountCategory}
                  </div>
                </div>

                <SecondaryButton
                  onClick={() => {
                    setPendingReceipt(null);
                    setMode('login');
                    switchPortal(pendingReceipt.accountCategory === 'Personal' ? 'PERSONAL' : 'CORPORATE');
                    setIdentifier(pendingReceipt.customerNumber);
                    setPassword('');
                  }}
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>{t('auth.backToLogin')}</span>
                </SecondaryButton>
              </div>
            ) : mode === 'login' ? (
              <div className="space-y-5">
                {/* Explicit Bireysel Giriş vs Kurumsal Giriş Portal Selector (Admin ONLY if reached via secret URL) */}
                {loginPortal !== 'ADMIN' ? (
                  <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-slate-100 dark:bg-[#18181D] border border-slate-200 dark:border-white/10">
                    <button
                      type="button"
                      onClick={() => switchPortal('PERSONAL')}
                      className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-all ${
                        loginPortal === 'PERSONAL'
                          ? 'bg-white dark:bg-[#09090B] text-[#EA580C] shadow-sm border border-orange-200/80 dark:border-orange-500/30'
                          : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900'
                      }`}
                    >
                      <User className="w-4 h-4 shrink-0" />
                      <span>{t('auth.portalPersonal')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => switchPortal('CORPORATE')}
                      className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-all ${
                        loginPortal === 'CORPORATE'
                          ? 'bg-white dark:bg-[#09090B] text-[#EA580C] shadow-sm border border-orange-200/80 dark:border-orange-500/30'
                          : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900'
                      }`}
                    >
                      <Building2 className="w-4 h-4 shrink-0" />
                      <span>{t('auth.portalCorporate')}</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-slate-900 text-white text-xs font-bold">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-[#F97316]" />
                      <span>{t('auth.portalAdmin')}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.location.hash) {
                          window.history.replaceState(null, '', window.location.pathname);
                        }
                        switchPortal('PERSONAL');
                      }}
                      className="text-[11px] text-orange-300 hover:underline"
                    >
                      ← {t('auth.portalPersonal')}
                    </button>
                  </div>
                )}

                <div>
                  <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
                    {loginPortal === 'CORPORATE'
                      ? t('auth.portalCorporate')
                      : loginPortal === 'ADMIN'
                      ? t('auth.portalAdmin')
                      : t('auth.portalPersonal')}
                  </h1>
                  <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1 leading-relaxed">
                    {loginPortal === 'CORPORATE'
                      ? t('auth.corporateOnlyHint')
                      : loginPortal === 'ADMIN'
                      ? t('auth.adminOnlyHint')
                      : t('auth.personalOnlyHint')}
                  </p>
                </div>

                <ErrorBanner message={localError} onDismiss={() => setLocalError(null)} />
                {localSuccess && (
                  <div className="p-3.5 rounded-2xl border border-emerald-200 bg-emerald-50/90 text-emerald-900 text-xs font-semibold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{localSuccess}</span>
                  </div>
                )}

                {lockedInfo && (
                  <div className="p-4 rounded-2xl border border-red-200 dark:border-red-500/30 bg-red-50/70 dark:bg-red-500/10 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                      <div className="text-xs space-y-1">
                        <div className="font-bold text-red-900 dark:text-red-200">{t('auth.lockedTitle')}</div>
                        <p className="text-red-800 dark:text-red-300 leading-relaxed">{t('auth.lockedDesc')}</p>
                        {lockedInfo.lockedUntil && (
                          <div className="font-mono-num text-[11px] text-red-700 dark:text-red-300">
                            Kilit Bitişi: {new Date(lockedInfo.lockedUntil).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>

                    {unlockSentTicketId ? (
                      <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>
                          {t('auth.unlockSent')} (Ref: #{unlockSentTicketId})
                        </span>
                      </div>
                    ) : (
                      <form onSubmit={handleRequestUnlock} className="space-y-2 pt-1 border-t border-red-200/70 dark:border-red-500/20">
                        <input
                          type="text"
                          value={unlockNote}
                          onChange={(e) => setUnlockNote(e.target.value)}
                          placeholder={t('auth.unlockNotePlaceholder')}
                          className="w-full min-h-[38px] px-3 rounded-xl border border-red-200 dark:border-red-500/30 bg-white dark:bg-[#18181D] text-xs"
                        />
                        <SecondaryButton
                          type="submit"
                          disabled={unlockSending}
                          className="w-full !min-h-[38px] text-xs !border-red-300 !text-red-700"
                        >
                          <Headset className="w-3.5 h-3.5" />
                          <span>{t('auth.requestUnlockBtn')}</span>
                        </SecondaryButton>
                      </form>
                    )}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  {loginPortal === 'CORPORATE' && (
                    <div className="p-3.5 rounded-2xl bg-orange-50/70 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/25 space-y-1.5">
                      <label className="block text-xs font-bold text-[#C2410C] dark:text-orange-300">
                        {t('auth.companyIdentifierLabel')}
                      </label>
                      <input
                        type="text"
                        required
                        value={companyIdentifier}
                        onChange={(e) => setCompanyIdentifier(e.target.value)}
                        placeholder={t('auth.companyIdentifierPlaceholder')}
                        className="w-full min-h-[44px] px-3.5 rounded-xl border border-orange-200 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                      {loginPortal === 'CORPORATE' ? t('auth.authorizedPersonLabel') : t('auth.identifierLabel')}
                    </label>
                    <input
                      type="text"
                      required
                      autoComplete="username"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder={t('auth.identifierPlaceholder')}
                      className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                      {t('auth.passwordLabel')}
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t('auth.passwordPlaceholder')}
                        className="w-full min-h-[46px] pl-3.5 pr-11 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-slate-900 dark:text-white text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 p-1"
                        aria-label="Toggle password"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <PrimaryButton type="submit" loading={loading} className="w-full !min-h-[48px] text-sm">
                    <Lock className="w-4 h-4" />
                    <span>
                      {loginPortal === 'CORPORATE'
                        ? t('auth.corporateLoginBtn')
                        : loginPortal === 'ADMIN'
                        ? t('auth.adminLoginBtn')
                        : t('auth.personalLoginBtn')}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </PrimaryButton>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-white/10 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setLocalError(null);
                        setLocalSuccess(null);
                        setLockedInfo(null);
                        setResetIdentifier(identifier);
                        setResetChallenge(null);
                        setMode('forgot_password');
                      }}
                      className="inline-flex items-center gap-1.5 font-semibold text-[#EA580C] hover:text-[#C2410C] dark:text-orange-400 hover:underline"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>{t('auth.forgotPasswordLink')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setLocalError(null);
                        setLocalSuccess(null);
                        setLockedInfo(null);
                        setRecoveredAccount(null);
                        setRecoverCompany(companyIdentifier);
                        setMode('forgot_username');
                      }}
                      className="inline-flex items-center gap-1.5 font-semibold text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white hover:underline"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                      <span>{t('auth.forgotUsernameLink')}</span>
                    </button>
                  </div>
                </form>
              </div>
            ) : mode === 'forgot_password' ? (
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => {
                    setLocalError(null);
                    setResetChallenge(null);
                    setMode('login');
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-zinc-400 hover:text-[#EA580C]"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{t('auth.backToLogin')}</span>
                </button>

                <div>
                  <h1 className="text-xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
                    {t('auth.forgotPasswordTitle')}
                  </h1>
                  <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1 leading-relaxed">
                    {t('auth.forgotPasswordDesc')}
                  </p>
                </div>

                <ErrorBanner message={localError} onDismiss={() => setLocalError(null)} />

                {!resetChallenge ? (
                  <form onSubmit={handleRequestPasswordReset} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                        {t('auth.identifierLabel')}
                      </label>
                      <input
                        type="text"
                        required
                        value={resetIdentifier}
                        onChange={(e) => setResetIdentifier(e.target.value)}
                        placeholder="deniz.kaya@promoney.test / 100001"
                        className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                        {t('auth.registeredPhoneLabel')}
                      </label>
                      <input
                        type="tel"
                        required
                        value={resetPhone}
                        onChange={(e) => setResetPhone(e.target.value)}
                        placeholder="+90 532 555 0192"
                        className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
                      />
                    </div>
                    <PrimaryButton type="submit" loading={resetLoading} className="w-full !min-h-[46px]">
                      <KeyRound className="w-4 h-4" />
                      <span>{t('auth.sendResetCodeBtn')}</span>
                    </PrimaryButton>
                  </form>
                ) : (
                  <form onSubmit={handleCompletePasswordReset} className="space-y-3.5">
                    <div className="p-3.5 rounded-2xl bg-orange-50/80 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30 text-xs space-y-1">
                      <div className="font-bold text-[#C2410C] dark:text-orange-300">
                        {t('auth.resetCodeSentBanner')} · {resetChallenge.maskedPhone} ({resetChallenge.maskedEmail})
                      </div>
                      {resetChallenge.sandboxResetCode && (
                        <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white pt-0.5">
                          Doğrulama Kodu: <span className="text-[#EA580C]">{resetChallenge.sandboxResetCode}</span>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                        {t('auth.resetCodeLabel')}
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={6}
                        value={resetCodeInput}
                        onChange={(e) => setResetCodeInput(e.target.value.replace(/\D/g, ''))}
                        placeholder="6 haneli kod"
                        className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num tracking-widest"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                          {t('auth.newPasswordLabel')}
                        </label>
                        <input
                          type="password"
                          required
                          minLength={6}
                          value={resetNewPassword}
                          onChange={(e) => setResetNewPassword(e.target.value)}
                          placeholder="••••••"
                          className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                          {t('auth.confirmPasswordLabel')}
                        </label>
                        <input
                          type="password"
                          required
                          minLength={6}
                          value={resetConfirmPassword}
                          onChange={(e) => setResetConfirmPassword(e.target.value)}
                          placeholder="••••••"
                          className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                        />
                      </div>
                    </div>

                    <PrimaryButton type="submit" loading={resetLoading} className="w-full !min-h-[46px]">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{t('auth.updatePasswordBtn')}</span>
                    </PrimaryButton>
                  </form>
                )}
              </div>
            ) : mode === 'forgot_username' ? (
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => {
                    setLocalError(null);
                    setMode('login');
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-zinc-400 hover:text-[#EA580C]"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{t('auth.backToLogin')}</span>
                </button>

                <div>
                  <h1 className="text-xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
                    {t('auth.forgotUsernameTitle')}
                  </h1>
                  <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1 leading-relaxed">
                    {t('auth.forgotUsernameDesc')}
                  </p>
                </div>

                <ErrorBanner message={localError} onDismiss={() => setLocalError(null)} />

                {recoveredAccount ? (
                  <div className="p-5 rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-500/10 space-y-4">
                    <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-bold text-sm">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      <span>{t('auth.recoveredResultTitle')}</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-xl bg-white dark:bg-[#18181D] border border-emerald-200/80 dark:border-white/10">
                        <div className="text-slate-500 dark:text-zinc-400">{t('auth.recoveredCustomerNo')}</div>
                        <div className="text-xl font-display font-bold font-mono-num text-[#EA580C] mt-0.5">
                          {recoveredAccount.customerNumber}
                        </div>
                      </div>
                      <div className="p-3 rounded-xl bg-white dark:bg-[#18181D] border border-emerald-200/80 dark:border-white/10">
                        <div className="text-slate-500 dark:text-zinc-400">{t('auth.recoveredMaskedEmail')}</div>
                        <div className="text-sm font-bold font-mono-num text-slate-900 dark:text-white mt-1">
                          {recoveredAccount.maskedEmail}
                        </div>
                      </div>
                    </div>

                    <PrimaryButton
                      type="button"
                      className="w-full !min-h-[44px]"
                      onClick={() => {
                        setIdentifier(recoveredAccount.customerNumber);
                        setPassword('');
                        setRecoveredAccount(null);
                        setMode('login');
                      }}
                    >
                      <KeyRound className="w-4 h-4" />
                      <span>{t('auth.useCustomerNoLogin')}</span>
                    </PrimaryButton>
                  </div>
                ) : (
                  <form onSubmit={handleRecoverUsername} className="space-y-3.5">
                    {loginPortal === 'CORPORATE' && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                          {t('auth.companyIdentifierLabel')}
                        </label>
                        <input
                          type="text"
                          required
                          value={recoverCompany}
                          onChange={(e) => setRecoverCompany(e.target.value)}
                          placeholder={t('auth.companyIdentifierPlaceholder')}
                          className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                        {t('auth.fullName')}
                      </label>
                      <input
                        type="text"
                        required
                        value={recoverFullName}
                        onChange={(e) => setRecoverFullName(e.target.value)}
                        placeholder="Deniz Kaya"
                        className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                        {t('auth.registeredPhoneLabel')}
                      </label>
                      <input
                        type="tel"
                        required
                        value={recoverPhone}
                        onChange={(e) => setRecoverPhone(e.target.value)}
                        placeholder="+90 532 555 0192"
                        className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
                      />
                    </div>
                    <PrimaryButton type="submit" loading={recoverLoading} className="w-full !min-h-[46px]">
                      <HelpCircle className="w-4 h-4" />
                      <span>{t('auth.findUsernameBtn')}</span>
                    </PrimaryButton>
                  </form>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h1 className="text-xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
                    {t('auth.registerTitle')}
                  </h1>
                  <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
                    {t('auth.registerSubtitle')}
                  </p>
                </div>

                <ErrorBanner message={localError} onDismiss={() => setLocalError(null)} />

                <form onSubmit={handleSubmit} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                      {t('auth.accountType')}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'Personal', label: t('auth.typePersonal'), icon: User },
                          { id: 'Business', label: t('auth.typeBusiness'), icon: Building2 },
                          { id: 'Merchant', label: t('auth.typeMerchant'), icon: Store },
                        ] as const
                      ).map((cat) => {
                        const Icon = cat.icon;
                        const active = accountCategory === cat.id;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setAccountCategory(cat.id)}
                            className={`p-2.5 rounded-xl border text-center flex flex-col items-center gap-1.5 transition-colors ${
                              active
                                ? 'border-[#F97316] bg-orange-50 text-[#EA580C] dark:bg-orange-500/15 dark:text-orange-300 font-bold'
                                : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-zinc-300 hover:border-slate-300'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                            <span className="text-[11px] leading-tight">{cat.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {accountCategory !== 'Personal' && (
                    <div className="p-3.5 rounded-2xl bg-orange-50/70 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/25 space-y-3">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-[#C2410C] dark:text-orange-300 flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5" />
                        <span>{t('auth.corpRegInfoHeader')}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                            {t('auth.companyName')}
                          </label>
                          <input
                            type="text"
                            required
                            value={companyName}
                            onChange={(e) => setCompanyName(e.target.value)}
                            placeholder={t('auth.companyPlaceholder')}
                            className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                            {t('auth.taxId')}
                          </label>
                          <input
                            type="text"
                            required
                            value={taxId}
                            onChange={(e) => setTaxId(e.target.value.toUpperCase())}
                            placeholder={t('auth.taxIdPlaceholder')}
                            className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num uppercase"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                        {t('auth.fullName')}
                      </label>
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder={t('auth.fullNamePlaceholder')}
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                        {t('auth.phone')}
                      </label>
                      <input
                        type="tel"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder={t('auth.phonePlaceholder')}
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                        {t('auth.email')}
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t('auth.emailPlaceholder')}
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                        {t('auth.country')}
                      </label>
                      <input
                        type="text"
                        maxLength={2}
                        value={country}
                        onChange={(e) => setCountry(e.target.value.toUpperCase())}
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm uppercase font-mono-num"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                        {t('verif.nationalIdNo')}
                      </label>
                      <input
                        type="text"
                        value={nationalIdNumber}
                        onChange={(e) => setNationalIdNumber(e.target.value)}
                        placeholder="11 Haneli Kimlik No"
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                        {t('verif.passportNo')}
                      </label>
                      <input
                        type="text"
                        value={passportNumber}
                        onChange={(e) => setPassportNumber(e.target.value.toUpperCase())}
                        placeholder="U12345678"
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num uppercase"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                        {t('verif.addressFull')}
                      </label>
                      <input
                        type="text"
                        value={addressLine}
                        onChange={(e) => setAddressLine(e.target.value)}
                        placeholder="Cadde, Sokak, Bina / Daire"
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                        {t('verif.city')}
                      </label>
                      <input
                        type="text"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
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
                        value={postalCode}
                        onChange={(e) => setPostalCode(e.target.value)}
                        placeholder="34000"
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm font-mono-num"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                      {t('auth.passwordLabel')}
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('auth.passwordPlaceholder')}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#18181D] text-sm"
                    />
                  </div>

                  <PrimaryButton type="submit" loading={loading} className="w-full !min-h-[46px]">
                    <UserPlus className="w-4 h-4" />
                    <span>{t('auth.submitApplication')}</span>
                  </PrimaryButton>
                </form>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
