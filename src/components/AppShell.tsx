import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Building2,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  HelpCircle,
  Home,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PiggyBank,
  Search,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  Smartphone,
  Store,
  Sun,
  User,
  Wallet,
  WifiOff,
  X,
} from 'lucide-react';
import { useBanking } from '../context/BankingContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWA.ts';
import { ProMoneyLogo } from './ProMoneyLogo.tsx';
import { ModalSheet, SemanticStateLabel } from './ui.tsx';

export type NavRoute =
  | 'overview'
  | 'accounts'
  | 'payments'
  | 'cards'
  | 'transfers'
  | 'exchange'
  | 'loans'
  | 'savings'
  | 'business'
  | 'pos'
  | 'analytics'
  | 'security'
  | 'support'
  | 'settings'
  | 'admin';

export type PortalType = 'PERSONAL' | 'BUSINESS' | 'MERCHANT' | 'ADMIN';

interface AppShellProps {
  activeRoute: NavRoute;
  onNavigate: (route: NavRoute) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  children: React.ReactNode;
}

interface NavItem {
  id: NavRoute;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  titleKey: string;
  items: NavItem[];
}

export function getPortalType(role?: string, isAdminUser?: boolean): PortalType {
  if (isAdminUser) return 'ADMIN';
  if (role === 'BUSINESS_MANAGER' || role === 'CORPORATE_CUSTOMER') return 'BUSINESS';
  if (role === 'MERCHANT') return 'MERCHANT';
  return 'PERSONAL';
}

export function getAllowedRoutes(portal: PortalType): NavRoute[] {
  if (portal === 'ADMIN') return ['admin', 'security', 'support', 'settings'];
  if (portal === 'BUSINESS') {
    return ['business', 'accounts', 'cards', 'transfers', 'payments', 'exchange', 'loans', 'analytics', 'security', 'support', 'settings'];
  }
  if (portal === 'MERCHANT') {
    return ['pos', 'accounts', 'cards', 'transfers', 'payments', 'exchange', 'analytics', 'security', 'support', 'settings'];
  }
  return ['overview', 'accounts', 'cards', 'transfers', 'payments', 'exchange', 'savings', 'loans', 'analytics', 'security', 'support', 'settings'];
}

export const AppShell: React.FC<AppShellProps> = ({
  activeRoute,
  onNavigate,
  searchQuery,
  onSearchChange,
  children,
}) => {
  const {
    data,
    hideBalances,
    toggleHideBalances,
    theme,
    toggleTheme,
    logout,
    apiFetch,
    refreshData,
    toast,
  } = useBanking();
  const { t } = useLanguage();
  const isOnline = useOnlineStatus();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [iosGuideOpen, setIosGuideOpen] = useState(false);

  const unreadCount = data?.notifications.filter((n) => !n.isRead).length || 0;
  const user = data?.user;
  const portal = getPortalType(user?.role, data?.isAdminUser);

  const navGroups: NavGroup[] = useMemo(() => {
    if (portal === 'ADMIN') {
      return [
        {
          titleKey: 'nav.group.management',
          items: [{ id: 'admin', labelKey: 'nav.admin', icon: ShieldCheck }],
        },
        {
          titleKey: 'nav.group.account',
          items: [
            { id: 'security', labelKey: 'nav.security', icon: Shield },
            { id: 'support', labelKey: 'nav.support', icon: HelpCircle },
            { id: 'settings', labelKey: 'nav.settings', icon: Settings },
          ],
        },
      ];
    }

    if (portal === 'BUSINESS') {
      return [
        {
          titleKey: 'nav.corp.groupTreasury',
          items: [
            { id: 'business', labelKey: 'nav.corp.dashboard', icon: Building2 },
            { id: 'accounts', labelKey: 'nav.corp.accounts', icon: Wallet },
            { id: 'cards', labelKey: 'nav.corp.cards', icon: CreditCard },
          ],
        },
        {
          titleKey: 'nav.corp.groupFinance',
          items: [
            { id: 'transfers', labelKey: 'nav.corp.transfers', icon: ArrowLeftRight },
            { id: 'payments', labelKey: 'nav.corp.payments', icon: Send },
            { id: 'exchange', labelKey: 'nav.corp.exchange', icon: ArrowLeftRight },
            { id: 'loans', labelKey: 'nav.corp.loans', icon: Landmark },
          ],
        },
        {
          titleKey: 'nav.corp.groupControl',
          items: [
            { id: 'analytics', labelKey: 'nav.corp.analytics', icon: BarChart3 },
            { id: 'security', labelKey: 'nav.corp.security', icon: Shield },
            { id: 'support', labelKey: 'nav.corp.support', icon: HelpCircle },
            { id: 'settings', labelKey: 'nav.corp.settings', icon: Settings },
          ],
        },
      ];
    }

    if (portal === 'MERCHANT') {
      return [
        {
          titleKey: 'nav.corp.groupTreasury',
          items: [
            { id: 'pos', labelKey: 'nav.corp.posDashboard', icon: Store },
            { id: 'accounts', labelKey: 'nav.corp.accounts', icon: Wallet },
            { id: 'cards', labelKey: 'nav.corp.cards', icon: CreditCard },
          ],
        },
        {
          titleKey: 'nav.corp.groupFinance',
          items: [
            { id: 'transfers', labelKey: 'nav.corp.transfers', icon: ArrowLeftRight },
            { id: 'payments', labelKey: 'nav.corp.payments', icon: Send },
            { id: 'exchange', labelKey: 'nav.corp.exchange', icon: ArrowLeftRight },
          ],
        },
        {
          titleKey: 'nav.corp.groupControl',
          items: [
            { id: 'analytics', labelKey: 'nav.corp.analytics', icon: BarChart3 },
            { id: 'security', labelKey: 'nav.corp.security', icon: Shield },
            { id: 'support', labelKey: 'nav.corp.support', icon: HelpCircle },
            { id: 'settings', labelKey: 'nav.corp.settings', icon: Settings },
          ],
        },
      ];
    }

    // Strict Personal Portal
    return [
      {
        titleKey: 'nav.group.personal',
        items: [
          { id: 'overview', labelKey: 'nav.overview', icon: LayoutDashboard },
          { id: 'accounts', labelKey: 'nav.accounts', icon: Wallet },
          { id: 'cards', labelKey: 'nav.cards', icon: CreditCard },
        ],
      },
      {
        titleKey: 'nav.group.money',
        items: [
          { id: 'transfers', labelKey: 'nav.transfers', icon: ArrowLeftRight },
          { id: 'payments', labelKey: 'nav.payments', icon: Send },
          { id: 'exchange', labelKey: 'nav.exchange', icon: ArrowLeftRight },
        ],
      },
      {
        titleKey: 'nav.group.wealth',
        items: [
          { id: 'savings', labelKey: 'nav.savings', icon: PiggyBank },
          { id: 'loans', labelKey: 'nav.loans', icon: Landmark },
        ],
      },
      {
        titleKey: 'nav.group.account',
        items: [
          { id: 'analytics', labelKey: 'nav.analytics', icon: BarChart3 },
          { id: 'security', labelKey: 'nav.security', icon: Shield },
          { id: 'support', labelKey: 'nav.support', icon: HelpCircle },
          { id: 'settings', labelKey: 'nav.settings', icon: Settings },
        ],
      },
    ];
  }, [portal]);

  const allPortalItems = useMemo(() => navGroups.flatMap((g) => g.items), [navGroups]);

  const mobileTabs: Array<{ id: NavRoute; labelKey: string; icon: React.ComponentType<{ className?: string }> }> = useMemo(() => {
    if (portal === 'ADMIN') {
      return [
        { id: 'admin', labelKey: 'mobile.admin', icon: ShieldCheck },
        { id: 'security', labelKey: 'nav.security', icon: Shield },
        { id: 'support', labelKey: 'nav.support', icon: HelpCircle },
        { id: 'settings', labelKey: 'mobile.settings', icon: User },
      ];
    }
    if (portal === 'BUSINESS') {
      return [
        { id: 'business', labelKey: 'mobile.corpHome', icon: Building2 },
        { id: 'accounts', labelKey: 'mobile.corpAccounts', icon: Wallet },
        { id: 'transfers', labelKey: 'mobile.corpTransfers', icon: Send },
        { id: 'cards', labelKey: 'mobile.corpCards', icon: CreditCard },
        { id: 'settings', labelKey: 'mobile.settings', icon: User },
      ];
    }
    if (portal === 'MERCHANT') {
      return [
        { id: 'pos', labelKey: 'mobile.pos', icon: Store },
        { id: 'accounts', labelKey: 'mobile.corpAccounts', icon: Wallet },
        { id: 'transfers', labelKey: 'mobile.corpTransfers', icon: Send },
        { id: 'analytics', labelKey: 'mobile.analytics', icon: BarChart3 },
        { id: 'settings', labelKey: 'mobile.settings', icon: User },
      ];
    }
    return [
      { id: 'overview', labelKey: 'mobile.home', icon: Home },
      { id: 'accounts', labelKey: 'mobile.accounts', icon: Wallet },
      { id: 'transfers', labelKey: 'mobile.transfers', icon: Send },
      { id: 'cards', labelKey: 'mobile.cards', icon: CreditCard },
      { id: 'settings', labelKey: 'mobile.settings', icon: User },
    ];
  }, [portal]);

  const homeRoute: NavRoute =
    portal === 'ADMIN' ? 'admin' : portal === 'BUSINESS' ? 'business' : portal === 'MERCHANT' ? 'pos' : 'overview';

  const markAllRead = async () => {
    await apiFetch('/api/notifications/read-all', { method: 'POST' });
    await refreshData();
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#09090B] text-slate-900 dark:text-zinc-50 flex flex-col lg:flex-row">
      {/* Desktop Left Fixed Sidebar (>= 1024px) */}
      <aside className="hidden lg:flex lg:w-[260px] lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0D0D11] z-30 no-print">
        <div className="h-16 px-5 flex items-center justify-between bg-gradient-to-r from-[#FF6B00] to-[#F97316] border-b border-[#EA580C]">
          <button type="button" onClick={() => onNavigate(homeRoute)} className="focus:outline-none">
            <ProMoneyLogo size="md" surface="orange" />
          </button>
        </div>

        {/* Clean Unboxed Institutional Portal Header */}
        <div className="px-5 py-3 border-b border-slate-100 dark:border-white/[0.06] space-y-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#EA580C] dark:text-orange-400 truncate">
              {t(`portal.${portal}`)}
            </span>
            <span className="text-[11px] font-mono-num font-semibold text-slate-500 dark:text-zinc-400 shrink-0">
              #{user?.customerNumber}
            </span>
          </div>
          {(portal === 'BUSINESS' || portal === 'MERCHANT') &&
            (data?.business?.entity?.companyName || data?.merchant?.profile?.businessName || user?.requestedCompanyName) && (
              <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                {data?.business?.entity?.companyName || data?.merchant?.profile?.businessName || user?.requestedCompanyName}
              </div>
            )}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {navGroups.map((group) => (
            <div key={group.titleKey} className="space-y-0.5">
              <div className="px-3 pb-1 text-[10px] font-bold tracking-widest uppercase text-slate-400 dark:text-zinc-500">
                {t(group.titleKey)}
              </div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeRoute === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-orange-50/90 text-[#C2410C] font-semibold dark:bg-orange-500/15 dark:text-orange-300'
                        : 'text-slate-600 dark:text-zinc-400 font-medium hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-[#F97316]" aria-hidden="true" />
                    )}
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        active ? 'text-[#EA580C] dark:text-orange-400' : 'text-slate-400 dark:text-zinc-500'
                      }`}
                    />
                    <span className="truncate">{t(item.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-200/80 dark:border-white/[0.08] bg-slate-50/60 dark:bg-[#0D0D11] space-y-3">
          {!isInstalled && (
            <button
              type="button"
              onClick={isInstallable ? install : () => setIosGuideOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold bg-orange-50 text-[#EA580C] border border-orange-200 hover:bg-orange-100 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t('common.installApp')}</span>
            </button>
          )}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="flex items-center gap-2.5 min-w-0 text-left hover:opacity-85 transition-opacity"
            >
              <div className="w-8 h-8 rounded-full bg-[#F97316] text-white flex items-center justify-center text-xs font-bold shrink-0">
                {user?.fullName?.slice(0, 2).toUpperCase() || 'PM'}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900 dark:text-white truncate">{user?.fullName}</div>
                <div className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">
                  {user?.membershipTier}
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={logout}
              title={t('common.signOut')}
              className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-white/10 transition-colors shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 lg:pl-[260px] flex flex-col min-w-0">
        {/* Desktop & Tablet Tangerine Orange Top Header */}
        <header className="hidden md:flex sticky top-0 z-20 h-16 px-6 items-center justify-between gap-4 bg-gradient-to-r from-[#FF6B00] via-[#F97316] to-[#EA580C] text-white border-b border-[#EA580C] shadow-sm no-print">
          <div className="flex items-center gap-4 min-w-0 flex-1 max-w-md">
            <div className="lg:hidden">
              <ProMoneyLogo variant="full" size="sm" surface="orange" />
            </div>
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t('common.searchPlaceholder')}
                className="w-full h-10 pl-9 pr-4 rounded-xl border border-white/25 bg-white text-slate-900 placeholder:text-slate-400 text-[13px] shadow-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">

            <button
              type="button"
              onClick={toggleHideBalances}
              aria-label="Toggle balance visibility"
              className="w-10 h-10 flex items-center justify-center rounded-xl border border-white/25 bg-white/15 hover:bg-white/25 text-white transition-colors"
            >
              {hideBalances ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="w-10 h-10 flex items-center justify-center rounded-xl border border-white/25 bg-white/15 hover:bg-white/25 text-white transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => setNotifOpen(true)}
              aria-label={t('common.notifications')}
              className="relative w-10 h-10 flex items-center justify-center rounded-xl border border-white/25 bg-white/15 hover:bg-white/25 text-white transition-colors"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-[#EA580C] text-[10px] font-bold flex items-center justify-center shadow-sm">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="flex items-center gap-2 pl-1.5 pr-3 h-10 rounded-xl border border-white/25 bg-white/15 hover:bg-white/25 text-white transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-white text-[#EA580C] flex items-center justify-center text-xs font-bold">
                {user?.fullName?.slice(0, 2).toUpperCase() || 'PM'}
              </div>
              <span className="text-xs font-semibold whitespace-nowrap">{user?.fullName}</span>
            </button>
          </div>
        </header>

        {/* Tablet Secondary Horizontal Module Strip (768px - 1023px) */}
        <div className="hidden md:flex lg:hidden items-center gap-1.5 overflow-x-auto px-4 py-2 border-b border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0D0D11] no-print">
          {allPortalItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                activeRoute === item.id
                  ? 'bg-[#F97316] text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-zinc-400'
              }`}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>

        {/* Mobile Sticky Tangerine Orange Top App Bar (< 768px) */}
        <header className="md:hidden sticky top-0 z-30 h-14 px-4 flex items-center justify-between bg-gradient-to-r from-[#FF6B00] via-[#F97316] to-[#EA580C] text-white border-b border-[#EA580C] shadow-sm pt-safe no-print">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open all modules"
              className="min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center rounded-xl text-white hover:bg-white/15 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <ProMoneyLogo size="sm" surface="orange" />
          </div>

          <div className="flex items-center gap-1">
            {!isInstalled && (
              <button
                type="button"
                onClick={isInstallable ? install : () => setIosGuideOpen(true)}
                aria-label={t('common.installApp')}
                className="min-w-[38px] min-h-[38px] flex items-center justify-center rounded-xl text-white hover:bg-white/15 transition-colors"
              >
                <Smartphone className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={toggleHideBalances}
              aria-label="Hide or show balances"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-white hover:bg-white/15 transition-colors"
            >
              {hideBalances ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={() => setNotifOpen(true)}
              aria-label={t('common.notifications')}
              className="relative min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-white hover:bg-white/15 transition-colors"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-white ring-2 ring-[#F97316]" />
              )}
            </button>
          </div>
        </header>

        {/* Main Content Viewport */}
        <main className="flex-1 px-4 py-5 md:px-6 md:py-6 pb-24 md:pb-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>

        {/* Mobile Fixed Bottom Navigation Bar — Tangerine Orange */}
        <nav
          aria-label="Mobile Navigation"
          className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-gradient-to-r from-[#FF6B00] via-[#F97316] to-[#EA580C] text-white border-t border-orange-400/40 shadow-[0_-4px_18px_rgba(234,88,12,0.22)] pb-safe no-print"
        >
          <div
            className="grid h-16 px-1.5 items-center gap-1"
            style={{ gridTemplateColumns: `repeat(${mobileTabs.length}, minmax(0, 1fr))` }}
          >
            {mobileTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive =
                activeRoute === tab.id ||
                (tab.id === 'transfers' && (activeRoute === 'payments' || activeRoute === 'exchange')) ||
                (tab.id === 'settings' && (activeRoute === 'security' || activeRoute === 'support'));
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onNavigate(tab.id)}
                  className={`flex flex-col items-center justify-center min-h-[48px] rounded-xl transition-all duration-150 ${
                    isActive
                      ? 'bg-white text-[#EA580C] shadow-sm font-bold'
                      : 'text-white/90 hover:text-white hover:bg-white/10 font-medium'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] mt-1 tracking-tight whitespace-nowrap truncate max-w-full px-1">
                    {t(tab.labelKey)}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Mobile Full Modules Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative w-[84%] max-w-xs bg-white dark:bg-[#0D0D11] h-full flex flex-col border-r border-slate-200 dark:border-white/10 z-10 shadow-2xl">
            <div className="h-14 px-4 flex items-center justify-between bg-gradient-to-r from-[#FF6B00] to-[#EA580C] text-white">
              <ProMoneyLogo size="sm" surface="orange" />
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-white hover:bg-white/15"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.06] flex items-center justify-between text-xs font-bold text-[#EA580C]">
              <span>{t(`portal.${portal}`)}</span>
              <span className="font-mono-num text-slate-500">#{user?.customerNumber}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
              {navGroups.map((group) => (
                <div key={group.titleKey} className="space-y-1">
                  <div className="px-3 pb-1 text-[10px] font-bold tracking-wider uppercase text-slate-400">
                    {t(group.titleKey)}
                  </div>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = activeRoute === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          onNavigate(item.id);
                          setMobileMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-colors ${
                          active
                            ? 'bg-[#F97316] text-white font-semibold shadow-sm'
                            : 'text-slate-700 dark:text-zinc-300 font-medium hover:bg-slate-50'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span>{t(item.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0D0D11] flex items-center justify-between">
              <button
                type="button"
                onClick={toggleTheme}
                className="text-xs font-semibold text-slate-700 dark:text-zinc-300 flex items-center gap-2"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span>{theme === 'dark' ? t('common.lightMode') : t('common.darkMode')}</span>
              </button>
              {!isInstalled && isIOS && (
                <button
                  type="button"
                  onClick={() => setIosGuideOpen(true)}
                  className="text-xs font-semibold text-[#EA580C]"
                >
                  iOS
                </button>
              )}
              <button type="button" onClick={logout} className="text-xs font-bold text-red-600">
                {t('common.signOut')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notifications Drawer/Modal */}
      <ModalSheet
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        title={`PRO MONEY · ${t('common.notifications')}`}
      >
        <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-white/10">
          <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">
            {unreadCount} {t('common.unread')}
          </span>
          <button type="button" onClick={markAllRead} className="text-xs font-semibold text-[#EA580C] hover:underline">
            {t('common.markAllRead')}
          </button>
        </div>
        <div className="space-y-3">
          {data?.notifications.length ? (
            data.notifications.map((n) => (
              <div
                key={n.id}
                className={`p-3.5 rounded-xl border ${
                  n.isRead
                    ? 'border-slate-200 dark:border-white/[0.06] bg-white dark:bg-transparent'
                    : 'border-orange-200 bg-orange-50/60 dark:border-orange-500/30 dark:bg-orange-500/[0.04]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{n.title}</span>
                  <SemanticStateLabel state={n.severity} />
                </div>
                <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1">{n.body}</p>
                <p className="text-[11px] text-slate-500 dark:text-zinc-500 mt-1.5 font-mono-num">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-500 py-4 text-center">{t('common.noNotifications')}</p>
          )}
        </div>
      </ModalSheet>

      <ModalSheet open={iosGuideOpen} onClose={() => setIosGuideOpen(false)} title={`${t('common.installApp')} · Desktop · Android · iOS`}>
        <div className="space-y-3 text-xs text-slate-700 dark:text-zinc-300 leading-relaxed">
          <div className="p-3 rounded-xl bg-orange-50/70 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30">
            <div className="font-bold text-[#EA580C]">iOS (iPhone / iPad · Safari)</div>
            <p className="mt-1">Safari alt menüden Paylaş (Share) → &quot;Ana Ekrana Ekle&quot; (Add to Home Screen) seçin.</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10">
            <div className="font-bold text-slate-900 dark:text-white">Android (Chrome / APK Paketi)</div>
            <p className="mt-1">Chrome menüsünden &quot;Uygulamayı Yükle&quot;ye dokunun veya Capacitor Android APK (capacitor.config.json) derleyin.</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10">
            <div className="font-bold text-slate-900 dark:text-white">Masaüstü (Windows / macOS / Linux)</div>
            <p className="mt-1">Adres çubuğundaki Yükle simgesini kullanın veya Electron paketini (desktop/electron-main.cjs) çalıştırın.</p>
          </div>
        </div>
      </ModalSheet>

      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl bg-slate-900 text-white border border-slate-700 shadow-xl text-xs font-medium flex items-center gap-2 no-print">
          <span
            className={`w-2 h-2 rounded-full ${
              toast.type === 'error' ? 'bg-red-400' : toast.type === 'success' ? 'bg-emerald-400' : 'bg-[#FB923C]'
            }`}
          />
          <span>{toast.title}</span>
        </div>
      )}

      {!isOnline && (
        <div className="fixed bottom-20 md:bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg no-print">
          <WifiOff className="w-4 h-4" />
          <span>{t('common.offlineNotice')}</span>
        </div>
      )}
    </div>
  );
};
