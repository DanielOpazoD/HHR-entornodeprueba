import { escapeHtml } from '@/utils/htmlEscape';

export interface MMRADReportSections {
  title: string | null;
  technique: string | null;
  antecedentesClinicos: string | null;
  findings: string | null;
  impression: string | null;
}

interface MMRADClipboardPayload extends Pick<
  MMRADReportSections,
  'title' | 'findings' | 'impression'
> {
  examName?: string | null;
  examDate?: string | null;
}

const REPORT_STOP_PATTERNS = [
  /^SALUDA ATENTAMENTE$/i,
  /^IMPRIMIR$/i,
  /^SAVE PDF$/i,
  /^VAR\s+/i,
  /^FUNCTION\s+/i,
  /^HTML2CANVAS/i,
  /^WINDOW\.OPEN/i,
  /^DOC\./i,
  /^\}$/i,
];

const normalizeWhitespace = (value: string): string =>
  value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

const findTitle = (normalized: string): string | null => {
  const firstLine = normalized
    .split('\n')
    .map(line => line.trim())
    .find(Boolean);
  if (!firstLine) return null;
  const upper = firstLine.toUpperCase();
  return upper.includes('TOMOGRAF') || upper.includes('ESCANER') ? firstLine : null;
};

const shouldStopReportSection = (line: string): boolean =>
  REPORT_STOP_PATTERNS.some(pattern => pattern.test(line));

export const parseMMRADReportSections = (html: string): MMRADReportSections | null => {
  const normalized = normalizeWhitespace(html);
  if (!normalized) return null;

  const lines = normalized
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const sections = new Map<string, string[]>();
  const sectionLabels = new Set(['TECNICA', 'ANTECEDENTES CLINICOS', 'HALLAZGOS', 'IMPRESION']);
  let currentSection: string | null = null;

  for (const line of lines) {
    const sectionKey = line.replace(/:$/, '').toUpperCase();
    if (sectionLabels.has(sectionKey)) {
      currentSection = sectionKey;
      if (!sections.has(sectionKey)) {
        sections.set(sectionKey, []);
      }
      continue;
    }

    if (currentSection) {
      if (shouldStopReportSection(line)) {
        currentSection = null;
        continue;
      }
      sections.get(currentSection)?.push(line);
    }
  }

  const title = findTitle(normalized);
  const technique = sections.get('TECNICA')?.join('\n') || null;
  const antecedentesClinicos = sections.get('ANTECEDENTES CLINICOS')?.join('\n') || null;
  const findings = sections.get('HALLAZGOS')?.join('\n') || null;
  const impression = sections.get('IMPRESION')?.join('\n') || null;

  if (!title && !findings && !impression) {
    return null;
  }

  return {
    title,
    technique,
    antecedentesClinicos,
    findings,
    impression,
  };
};

const toTitleCase = (value: string): string =>
  value.replace(/\S+/g, token => {
    const lower = token.toLocaleLowerCase('es-CL');
    return lower.charAt(0).toLocaleUpperCase('es-CL') + lower.slice(1);
  });

const formatMmradExamLabel = (
  examName?: string | null,
  reportTitle?: string | null
): string | null => {
  const source = (reportTitle || examName || '').replace(/\s+/g, ' ').trim();
  if (!source) return null;

  const lower = source.toLocaleLowerCase('es-CL');
  const tomografiaBody = lower.replace(
    /^tomograf(?:ia|ía)(?:\s+computada)?(?:\s+simple)?(?:\s+de)?\s+/i,
    ''
  );
  if (tomografiaBody !== lower && tomografiaBody.trim()) {
    return `TAC de ${toTitleCase(tomografiaBody.trim())}`;
  }

  const tcBody = lower.replace(/^(?:tc|tac)(?:\s+de)?\s+/i, '');
  if (tcBody !== lower && tcBody.trim()) {
    return `TAC de ${toTitleCase(tcBody.trim())}`;
  }

  return toTitleCase(source);
};

const formatMmradExamDate = (examDate?: string | null): string | null => {
  if (!examDate) return null;
  const match = examDate.match(/(\d{2})[/.-](\d{2})[/.-](\d{4})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
};

export const buildMMRADReportClipboardText = ({
  examName,
  examDate,
  title,
  findings,
  impression,
}: MMRADClipboardPayload): string | null => {
  const toContinuousParagraph = (value: string): string => value.replace(/\s*\n\s*/g, ' ').trim();
  const examLabel = formatMmradExamLabel(examName, title);
  const formattedDate = formatMmradExamDate(examDate);

  const sections = [
    examLabel ? `${examLabel}${formattedDate ? ` (${formattedDate})` : ''}.` : null,
    findings ? `Hallazgos: ${toContinuousParagraph(findings)}` : null,
    impression ? `Impresión: ${toContinuousParagraph(impression)}` : null,
  ].filter(Boolean);

  return sections.length > 0 ? sections.join('\n\n') : null;
};

const toPrintableBlock = (label: string, value: string | null): string =>
  value
    ? `<section style="margin-bottom:24px;"><h2 style="margin:0 0 10px;font-size:18px;font-weight:700;">${label}</h2><div style="white-space:pre-wrap;font-size:16px;line-height:1.5;">${value}</div></section>`
    : '';

export const buildMMRADReportPrintHtml = (
  examName: string,
  examDate: string,
  report: MMRADReportSections
): string => {
  const safeTitle = escapeHtml(report.title || examName || 'Informe radiologico');
  const safeDate = examDate
    ? `<p style="margin:0 0 20px;color:#475569;">Fecha: ${escapeHtml(examDate)}</p>`
    : '';

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
  </head>
  <body style="font-family: Arial, Helvetica, sans-serif; color:#111827; margin:32px;">
    <main>
      <h1 style="margin:0 0 12px;font-size:28px;font-weight:800;">${safeTitle}</h1>
      ${safeDate}
      ${toPrintableBlock('TECNICA', report.technique ? escapeHtml(report.technique) : null)}
      ${toPrintableBlock(
        'ANTECEDENTES CLINICOS',
        report.antecedentesClinicos ? escapeHtml(report.antecedentesClinicos) : null
      )}
      ${toPrintableBlock('HALLAZGOS', report.findings ? escapeHtml(report.findings) : null)}
      ${toPrintableBlock('IMPRESION', report.impression ? escapeHtml(report.impression) : null)}
    </main>
  </body>
</html>`;
};

export const buildMMRADPortalReceiptPrintHtml = (receiptHtml: string): string => {
  const sanitizedReceiptHtml = receiptHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+=["'][^"']*["']/gi, '')
    .replace(
      /<div\b[^>]*>\s*<button\b[^>]*>\s*Imprimir(?:\s*\/\s*guardar\s*PDF)?\s*<\/button>\s*<\/div>/gi,
      ''
    )
    .replace(/<button\b[^>]*>\s*Imprimir(?:\s*\/\s*guardar\s*PDF)?\s*<\/button>/gi, '')
    .replace(
      /<input\b(?=[^>]*\btype=["']?(?:button|submit)["']?)(?=[^>]*\bvalue=["']?Imprimir["']?)[^>]*>/gi,
      ''
    );

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Comprobante Portal Web paciente</title>
    <style>
      @page { margin: 10mm; }
      body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111827; background: #fff; }
      .mmrad-receipt-surface { padding: 0; }
      .mmrad-receipt-surface table { width: 100%; border-collapse: collapse; }
      @media print {
        button,
        input[type='button'],
        input[type='submit'] {
          display: none !important;
        }
        body { margin: 0 !important; }
      }
    </style>
  </head>
  <body>
    <main class="mmrad-receipt-surface">
      ${sanitizedReceiptHtml}
    </main>
  </body>
</html>`;
};
