import { GoogleGenAI } from '@google/genai';
import { db } from './db.ts';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function runFinancialAssistant(params: {
  userId: string;
  prompt: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}) {
  // Strictly load ONLY the authenticated user's own authorized financial records
  const user = db.prepare('SELECT full_name, membership_tier, kyc_status, country FROM users WHERE id = ?').get(params.userId) as any;
  const accounts = db.prepare('SELECT id, label, type, currency, available_balance, ledger_balance, pending_amount, status FROM accounts WHERE user_id = ?').all(params.userId) as any[];
  const recentTx = db
    .prepare(
      'SELECT id, counterparty_name, type, category, amount, fee, currency, direction, status, created_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
    )
    .all(params.userId) as any[];
  const cards = db.prepare('SELECT id, scheme, product_type, last4, status, daily_limit, spent_today FROM cards WHERE user_id = ?').all(params.userId) as any[];
  const loans = db.prepare('SELECT product_type, outstanding_balance, apr_percent, monthly_installment, currency, status FROM loans WHERE user_id = ?').all(params.userId) as any[];
  const alerts = db.prepare('SELECT case_type, severity, reason, status FROM aml_fraud_cases WHERE user_id = ?').all(params.userId) as any[];

  const scopedContext = {
    brand: 'PRO MONEY',
    environment: 'SANDBOX / TEST LEDGER',
    user,
    accounts,
    recentTransactions: recentTx,
    cards,
    loans,
    securityAlerts: alerts,
  };

  const ai = getAiClient();
  const systemInstruction = [
    'You are the PRO MONEY AI Financial Assistant inside the PRO MONEY digital banking platform.',
    'STRICT PRIVACY & AUTHORIZATION RULE: You only have access to the authenticated user context provided below. Never invent balances, never speculate about other users, and never claim to execute transfers or card actions autonomously—always instruct the user to confirm actions through the PRO MONEY UI.',
    'All balances shown in this environment are TEST/SANDBOX records unless connected to a live banking provider.',
    'Respond concisely in the user’s language (Turkish or English), with clear numbers, spending category insights, budget tips, and flagged risk explanations when relevant.',
    `AUTHORIZED USER CONTEXT (JSON): ${JSON.stringify(scopedContext)}`,
  ].join('\n\n');

  const conversationText = (params.history || [])
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'PRO MONEY Assistant'}: ${m.content}`)
    .join('\n');

  const fullPrompt = conversationText
    ? `${conversationText}\nUser: ${params.prompt}`
    : params.prompt;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: fullPrompt,
    config: {
      systemInstruction,
    },
  });

  return {
    reply: response.text || 'Unable to generate an insight right now.',
    model: 'gemini-4-hydrogen',
    scopedAccountCount: accounts.length,
    scopedTransactionCount: recentTx.length,
  };
}
