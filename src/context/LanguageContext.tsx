import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { SUPPORTED_LANGUAGES, TRANSLATIONS, type LangCode } from '../i18n/translations.ts';

interface LanguageContextValue {
  lang: LangCode;
  dir: 'ltr' | 'rtl';
  deviceLocale: string;
  setLang: (code: LangCode) => void;
  t: (key: string, fallback?: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function detectDeviceLanguage(): { lang: LangCode; rawLocale: string } {
  if (typeof navigator === 'undefined') return { lang: 'en', rawLocale: 'en-US' };
  const candidates =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language || 'en'];

  const supported = new Set<LangCode>(['tr', 'en', 'de', 'fr', 'ar']);
  for (const loc of candidates) {
    if (!loc) continue;
    const base = loc.toLowerCase().split(/[-_]/)[0] as LangCode;
    if (supported.has(base) && TRANSLATIONS[base]) {
      return { lang: base, rawLocale: loc };
    }
  }
  return { lang: 'en', rawLocale: candidates[0] || 'en' };
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [{ lang, rawLocale }, setDetected] = useState<{ lang: LangCode; rawLocale: string }>(detectDeviceLanguage);

  const meta = SUPPORTED_LANGUAGES.find((l) => l.code === lang) || SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    const syncDeviceLang = () => {
      setDetected(detectDeviceLanguage());
    };
    window.addEventListener('languagechange', syncDeviceLang);
    return () => window.removeEventListener('languagechange', syncDeviceLang);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = meta.dir;
  }, [lang, meta.dir]);

  const setLang = useCallback((code: LangCode) => {
    if (TRANSLATIONS[code]) {
      setDetected((prev) => ({ ...prev, lang: code }));
    }
  }, []);

  const t = useCallback(
    (key: string, fallback?: string) => {
      return TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.en[key] ?? TRANSLATIONS.tr[key] ?? fallback ?? key;
    },
    [lang]
  );

  return (
    <LanguageContext.Provider value={{ lang, dir: meta.dir, deviceLocale: rawLocale, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
  return ctx;
}
