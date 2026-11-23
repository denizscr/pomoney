import crypto from 'node:crypto';
import type { CardScheme } from './types.ts';

export interface GeneratedCardDetails {
  bin: string;
  pan: string;
  panFormatted: string;
  last4: string;
  cvv: string;
  issuerLabel: string;
}

const TURKISH_BINS: Record<CardScheme, { DEBIT: string[]; CREDIT: string[] }> = {
  TROY: {
    DEBIT: ['979200', '979210', '979221'],
    CREDIT: ['979245', '979260', '979288'],
  },
  VISA: {
    DEBIT: ['454360', '402277', '454671'],
    CREDIT: ['454314', '435508', '450634'],
  },
  MASTERCARD: {
    DEBIT: ['540667', '516888', '526911'],
    CREDIT: ['552879', '540061', '525410'],
  },
};

export function computeLuhnCheckDigit(partial15: string): string {
  const digits = partial15.replace(/\D/g, '');
  let sum = 0;
  // Working right-to-left on the 15-digit payload: odd positions from right (1st, 3rd, ...) double
  for (let i = digits.length - 1, pos = 0; i >= 0; i--, pos++) {
    let n = Number(digits[i]);
    if (pos % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  const check = (10 - (sum % 10)) % 10;
  return String(check);
}

export function isValidLuhn(pan: string): boolean {
  const digits = pan.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (shouldDouble) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export function formatPan(pan: string): string {
  const digits = pan.replace(/\D/g, '');
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

export function maskPan(pan: string): string {
  const digits = pan.replace(/\D/g, '');
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)} •••• •••• ${digits.slice(-4)}`;
  }
  const last4 = digits.slice(-4).padStart(4, '•');
  return `•••• •••• •••• ${last4}`;
}

export function generateTurkishCardNumber(
  scheme: CardScheme,
  productType: 'DEBIT' | 'CREDIT' = 'DEBIT',
  deterministicSeed?: string
): GeneratedCardDetails {
  const normalizedScheme: CardScheme =
    scheme === 'VISA' || scheme === 'MASTERCARD' || scheme === 'TROY' ? scheme : 'TROY';
  const kind: 'DEBIT' | 'CREDIT' = productType === 'CREDIT' ? 'CREDIT' : 'DEBIT';
  const binPool = TURKISH_BINS[normalizedScheme][kind];

  const seedBytes = deterministicSeed
    ? crypto.createHash('sha256').update(`promoney-card:${deterministicSeed}:${normalizedScheme}:${kind}`).digest()
    : crypto.randomBytes(16);

  const bin = binPool[seedBytes[0] % binPool.length];
  let accountDigits = '';
  for (let i = 1; i <= 9; i++) {
    accountDigits += String(seedBytes[i] % 10);
  }

  const partial15 = `${bin}${accountDigits}`;
  const checkDigit = computeLuhnCheckDigit(partial15);
  const pan = `${partial15}${checkDigit}`;
  const panFormatted = formatPan(pan);
  const last4 = pan.slice(-4);
  const cvvNum = 100 + (((seedBytes[10] << 8) | seedBytes[11]) % 900);
  const cvv = String(cvvNum);
  const issuerLabel = `PRO MONEY TR (${normalizedScheme} ${kind === 'CREDIT' ? 'Kredi' : 'Banka'})`;

  return {
    bin,
    pan,
    panFormatted,
    last4,
    cvv,
    issuerLabel,
  };
}
