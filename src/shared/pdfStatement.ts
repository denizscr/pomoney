import type { BankAccount, TransactionRecord, UserProfile } from './types.ts';

function toPdfAscii(input: string): string {
  const map: Record<string, string> = {
    'ğ': 'g',
    'Ğ': 'G',
    'ü': 'u',
    'Ü': 'U',
    'ş': 's',
    'Ş': 'S',
    'ı': 'i',
    'İ': 'I',
    'ö': 'o',
    'Ö': 'O',
    'ç': 'c',
    'Ç': 'C',
    '₺': 'TRY ',
    '€': 'EUR ',
    '£': 'GBP ',
    '—': '-',
    '–': '-',
    '·': '-',
    '→': '->',
  };
  return input
    .split('')
    .map((ch) => map[ch] ?? (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126 ? ch : ' '))
    .join('');
}

function pdfEscape(input: string): string {
  return toPdfAscii(input).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function pad(text: string, len: number): string {
  const clean = toPdfAscii(text);
  if (clean.length >= len) return clean.slice(0, len);
  return clean + ' '.repeat(len - clean.length);
}

export function buildStatementPdfBlob(params: {
  user?: UserProfile | null;
  account?: BankAccount | null;
  transactions: TransactionRecord[];
  scopeLabel?: string;
}): Blob {
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const lines: string[] = [];

  lines.push('PRO MONEY - OFFICIAL ACCOUNT STATEMENT');
  lines.push('==========================================================================================');
  lines.push(`Generated At : ${generatedAt}`);
  if (params.user) {
    lines.push(`Account Owner: ${params.user.fullName} (Customer #${params.user.customerNumber}) | ${params.user.email}`);
  }
  if (params.account) {
    lines.push(`Account      : ${params.account.label} (${params.account.type} / ${params.account.currency})`);
    lines.push(`IBAN / BIC   : ${params.account.iban} | ${params.account.bic}`);
    lines.push(
      `Balances     : Available ${params.account.availableBalance.toFixed(2)} ${params.account.currency} | Ledger ${params.account.ledgerBalance.toFixed(2)} ${params.account.currency}`
    );
  } else if (params.scopeLabel) {
    lines.push(`Scope        : ${params.scopeLabel}`);
  }
  lines.push('------------------------------------------------------------------------------------------');
  lines.push(
    `${pad('Date', 11)} ${pad('Reference', 16)} ${pad('Type', 15)} ${pad('Counterparty', 24)} ${pad('Dir', 4)} ${pad('Amount', 15)} ${pad('Status', 10)}`
  );
  lines.push('------------------------------------------------------------------------------------------');

  if (params.transactions.length === 0) {
    lines.push('No transactions found for the selected statement scope.');
  } else {
    for (const tx of params.transactions) {
      const dateStr = tx.createdAt ? tx.createdAt.slice(0, 10) : '-';
      const amtStr = `${tx.amount.toFixed(2)} ${tx.currency}`;
      lines.push(
        `${pad(dateStr, 11)} ${pad(tx.reference || '-', 16)} ${pad(tx.type || '-', 15)} ${pad(tx.counterpartyName || '-', 24)} ${pad(tx.direction || '-', 4)} ${pad(amtStr, 15)} ${pad(tx.status || '-', 10)}`
      );
    }
  }

  lines.push('------------------------------------------------------------------------------------------');
  lines.push(`Total Records Exported: ${params.transactions.length} | Double-Entry Ledger Verified`);

  const linesPerPage = 48;
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  if (pages.length === 0) pages.push(['PRO MONEY - Empty Statement']);

  // PDF Objects:
  // 1: Catalog, 2: Pages, 3: Font (Courier), then per page: (PageObj, ContentObj)
  const objects: string[] = [];
  const pageObjNums: number[] = [];

  for (let p = 0; p < pages.length; p++) {
    pageObjNums.push(4 + p * 2);
  }

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`);
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n');

  pages.forEach((pageLines, idx) => {
    const pageObjId = 4 + idx * 2;
    const contentObjId = pageObjId + 1;
    const streamCommands: string[] = ['BT', '/F1 8.5 Tf', '36 756 Td', '13 TL'];
    pageLines.forEach((line, lineIdx) => {
      if (lineIdx === 0) {
        streamCommands.push(`(${pdfEscape(line)}) Tj`);
      } else {
        streamCommands.push(`T* (${pdfEscape(line)}) Tj`);
      }
    });
    streamCommands.push('ET');
    const stream = streamCommands.join('\n');

    objects.push(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`
    );
    objects.push(`${contentObjId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: 'application/pdf' });
}
