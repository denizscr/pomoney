import React, { useEffect, useState } from 'react';
import { AppShell, getAllowedRoutes, getPortalType, type NavRoute } from './components/AppShell.tsx';
import { AuthScreens } from './components/AuthScreens.tsx';
import { ProMoneyLogo } from './components/ProMoneyLogo.tsx';
import { BankingProvider, useBanking } from './context/BankingContext.tsx';
import { useLanguage } from './context/LanguageContext.tsx';
import { AccountsView } from './views/AccountsView.tsx';
import { AdminView } from './views/AdminView.tsx';
import { AnalyticsAiView } from './views/AnalyticsAiView.tsx';
import { BusinessView } from './views/BusinessView.tsx';
import { CardsView } from './views/CardsView.tsx';
import { ExchangeView } from './views/ExchangeView.tsx';
import { MerchantPosView } from './views/MerchantPosView.tsx';
import { OverviewView } from './views/OverviewView.tsx';
import { PaymentsTransfersView } from './views/PaymentsTransfersView.tsx';
import { SecurityKycSupportView } from './views/SecurityKycSupportView.tsx';
import { WealthView } from './views/WealthView.tsx';

function resolveRequestedRoute(): NavRoute | null {
  if (typeof window === 'undefined') return null;
  const h = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  const q = new URLSearchParams(window.location.search).get('view')?.toLowerCase() || '';
  const target = q || h;
  if (target === 'transfer' || target === 'transfers' || target === 'para-gonder') return 'transfers';
  if (target === 'admin' || target === 'yonetim') return 'admin';
  if (target === 'business' || target === 'sirket') return 'business';
  if (target === 'pos') return 'pos';
  if (target === 'accounts' || target === 'hesaplar') return 'accounts';
  if (target === 'cards' || target === 'kartlar') return 'cards';
  if (target === 'exchange' || target === 'doviz') return 'exchange';
  if (target === 'security' || target === 'dogrulama') return 'security';
  if (target === 'settings' || target === 'ayarlar') return 'settings';
  return null;
}

const BankingRouter: React.FC = () => {
  const { token, data, loading } = useBanking();
  const { t } = useLanguage();
  const [activeRoute, setActiveRoute] = useState<NavRoute>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSplashDone(true), 350);
    return () => clearTimeout(timer);
  }, []);

  const portal = getPortalType(data?.user?.role, data?.isAdminUser);
  const allowedRoutes = getAllowedRoutes(portal);

  useEffect(() => {
    if (!data?.user) return;
    const requested = resolveRequestedRoute();
    if (requested && allowedRoutes.includes(requested)) {
      setActiveRoute(requested);
      return;
    }
    if (portal === 'ADMIN') {
      setActiveRoute('admin');
    } else if (portal === 'BUSINESS') {
      setActiveRoute('business');
    } else if (portal === 'MERCHANT') {
      setActiveRoute('pos');
    } else {
      setActiveRoute('overview');
    }
  }, [data?.user?.id, portal]);

  useEffect(() => {
    const onHashChange = () => {
      if (!data?.user) return;
      const requested = resolveRequestedRoute();
      if (requested && allowedRoutes.includes(requested)) {
        setActiveRoute(requested);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [data?.user, allowedRoutes]);

  const handleNavigate = (route: NavRoute) => {
    const nextRoute = allowedRoutes.includes(route) ? route : allowedRoutes[0];
    setActiveRoute(nextRoute);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${nextRoute}`);
    }
  };

  if (!splashDone) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#09090B] text-slate-900 dark:text-white flex flex-col items-center justify-center p-6">
        <ProMoneyLogo size="lg" />
        <p className="text-xs font-semibold text-[#EA580C] dark:text-[#FB923C] mt-4 tracking-widest uppercase">
          {t('brand.tagline')}
        </p>
      </div>
    );
  }

  if (!token) {
    return <AuthScreens />;
  }

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#09090B] text-slate-900 dark:text-zinc-100 flex flex-col items-center justify-center p-6 gap-4">
        <ProMoneyLogo size="lg" />
        <p className="text-xs font-medium text-slate-600 dark:text-zinc-400">{t('common.loading')}</p>
      </div>
    );
  }

  const effectiveRoute = allowedRoutes.includes(activeRoute) ? activeRoute : allowedRoutes[0];

  const renderRoute = () => {
    switch (effectiveRoute) {
      case 'overview':
        return <OverviewView onNavigate={handleNavigate} searchQuery={searchQuery} />;
      case 'accounts':
        return <AccountsView />;
      case 'payments':
        return <PaymentsTransfersView initialTab="qr" />;
      case 'transfers':
        return <PaymentsTransfersView initialTab="transfer" />;
      case 'cards':
        return <CardsView />;
      case 'exchange':
        return <ExchangeView />;
      case 'savings':
        return <WealthView initialTab="savings" />;
      case 'loans':
        return <WealthView initialTab="loans" />;
      case 'business':
        return <BusinessView />;
      case 'pos':
        return <MerchantPosView />;
      case 'analytics':
        return <AnalyticsAiView />;
      case 'security':
        return <SecurityKycSupportView section="security" />;
      case 'support':
        return <SecurityKycSupportView section="support" />;
      case 'settings':
        return <SecurityKycSupportView section="settings" />;
      case 'admin':
        return data?.isAdminUser ? <AdminView /> : <OverviewView onNavigate={handleNavigate} searchQuery={searchQuery} />;
      default:
        return <OverviewView onNavigate={handleNavigate} searchQuery={searchQuery} />;
    }
  };

  return (
    <AppShell
      activeRoute={effectiveRoute}
      onNavigate={handleNavigate}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
    >
      {renderRoute()}
    </AppShell>
  );
};

export default function App() {
  return (
    <BankingProvider>
      <BankingRouter />
    </BankingProvider>
  );
}
