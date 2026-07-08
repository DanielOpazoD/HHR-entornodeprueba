/**
 * @module labSummaryController
 * @description Pure controller that generates compact lab summary text
 * for insertion into clinical documents.
 *
 * Uses clinical abbreviations (Hb, HTO, RGB, PMN, etc.) and omits units
 * for universally known variables. Shows units only for variables where
 * the unit may vary (PCR, Troponina, Dímero D, etc.).
 *
 * @example
 * ```
 * Laboratorio (08/04/2026 14:00): Hb 13 HTO 40% RGB 7.000 PMN 70% Creat 1 BUN 35
 * Na 140 K 4,8 Cl 113 Mg 1,5 HCO3 20 PCR 57 mg/L VHS 100 GOT 34 GPT 34 GGT 40
 * FA 20 BT 2 BD 1
 * ```
 */

import type { LabResultRow } from '@/types/domain/labExamTypes';
import {
  formatLabResult,
  normalizeAnalysisName,
  parseScientificValue,
} from './labFormattingController';

/* ------------------------------------------------------------------ */
/*  Clinical abbreviation map                                          */
/* ------------------------------------------------------------------ */

interface AbbreviationConfig {
  /** Short clinical abbreviation. */
  abbr: string;
  /** If true, append the unit from the finding (for variable-unit exams). */
  showUnit?: boolean;
  /** If set, multiply the result by 10^N and show as integer (e.g., RGB, Plaquetas). */
  multiplyExponent?: number;
  /** Append this suffix after the value (e.g., "%" for percentages). */
  suffix?: string;
}

/**
 * Map of normalized analysis names to their clinical abbreviations.
 * Order in this map defines display priority.
 * Partial case-insensitive matching is used.
 */
const SUMMARY_ABBREVIATIONS: [string, AbbreviationConfig][] = [
  // Hemograma
  ['Hemoglobina', { abbr: 'Hb' }],
  ['Hematocrito', { abbr: 'HTO', suffix: '%' }],
  ['Recuento Leucocitos', { abbr: 'RGB', multiplyExponent: 3 }],
  ['Recuento de Plaquetas', { abbr: 'Plaq', multiplyExponent: 3 }],
  // Fórmula
  ['Segmentados', { abbr: 'PMN', suffix: '%' }],
  ['Linfocitos', { abbr: 'Linf', suffix: '%' }],
  // Inflamación
  ['Proteina C Reactiva', { abbr: 'PCR', showUnit: true }],
  ['VHS', { abbr: 'VHS' }],
  // Función renal
  ['Creatinina', { abbr: 'Creat' }],
  ['Nitrogeno Ureico', { abbr: 'BUN' }],
  ['Uremia', { abbr: 'Uremia' }],
  // Electrolitos
  ['Sodio', { abbr: 'Na' }],
  ['Potasio', { abbr: 'K' }],
  ['Cloro', { abbr: 'Cl' }],
  ['Magnesio', { abbr: 'Mg' }],
  ['Calcio', { abbr: 'Ca' }],
  ['Fosforo', { abbr: 'P' }],
  // Gases
  ['pH', { abbr: 'pH' }],
  ['pCO2', { abbr: 'pCO2' }],
  ['pO2', { abbr: 'pO2' }],
  ['HCO3', { abbr: 'HCO3' }],
  ['Lactato', { abbr: 'Lac', showUnit: true }],
  // Hepático
  ['ASAT/GOT', { abbr: 'GOT' }],
  ['ALAT/GPT', { abbr: 'GPT' }],
  ['GGT', { abbr: 'GGT' }],
  ['Fosfatasa Alcalina', { abbr: 'FA' }],
  ['Bilirrubina Total', { abbr: 'BT' }],
  ['Bilirrubina Directa', { abbr: 'BD' }],
  // Otros
  ['Lipasa', { abbr: 'Lipasa' }],
  ['Albumina', { abbr: 'Alb' }],
  ['Glicemia', { abbr: 'Gli' }],
  ['TSH', { abbr: 'TSH', showUnit: true }],
  ['Troponina', { abbr: 'TnUS', showUnit: true }],
  ['Dimero', { abbr: 'DD', showUnit: true }],
  ['CK Total', { abbr: 'CK', showUnit: true }],
  ['LDH', { abbr: 'LDH' }],
  ['Protrombina', { abbr: 'TP', suffix: '%' }],
  ['INR', { abbr: 'INR' }],
  ['TTPK', { abbr: 'TTPK' }],
];

/* ------------------------------------------------------------------ */
/*  Core function                                                      */
/* ------------------------------------------------------------------ */

/**
 * Format a single finding value for the summary.
 * Handles x10^N multiplication, unit display, and suffix.
 */
const formatSummaryValue = (finding: LabResultRow, config: AbbreviationConfig): string => {
  let value = finding.result;

  // Multiply x10^N values (e.g., RGB 5,81 x10^3 → 5.810)
  if (config.multiplyExponent) {
    const sci = parseScientificValue(value, finding.unit);
    if (sci) {
      value = sci.multiplied.toLocaleString('es-CL');
    }
  }

  // Build display string
  let display = `${config.abbr} ${value}`;

  // Add suffix (e.g., %)
  if (config.suffix) {
    display += config.suffix;
  }

  // Add unit for variable-unit exams
  if (config.showUnit && finding.unit) {
    const cleanUnit = finding.unit.replace(/^x10\^\d+\//, '/').replace(/^\//, '');
    display += ` ${cleanUnit}`;
  }

  return display;
};

const formatFallbackFinding = (finding: LabResultRow): string | null => {
  const analysis = normalizeAnalysisName(finding.analysis, finding.section);
  const result = String(finding.result || '').trim();
  if (!analysis || !result) {
    return null;
  }

  const formatted = formatLabResult(result, finding.unit || '');
  const unit = formatted.displayUnit ? ` ${formatted.displayUnit}` : '';
  return `${analysis} ${formatted.display}${unit}`;
};

const buildFallbackSummaryParts = (findings: LabResultRow[]): string[] =>
  findings
    .map(formatFallbackFinding)
    .filter((value): value is string => Boolean(value))
    .slice(0, 12);

/**
 * Build a compact one-line lab summary from parsed findings.
 *
 * @param findings - Parsed lab result rows from a single exam.
 * @param date - Exam date (DD/MM/YYYY format).
 * @param time - Exam time (HH:MM:SS or HH:MM format).
 * @returns Formatted summary string ready for insertion into clinical documents.
 *
 * @example
 * ```ts
 * buildLabSummaryText(findings, '08/04/2026', '14:00:00')
 * // "Laboratorio (08/04/2026 14:00): Hb 13 HTO 40% RGB 7.000 PMN 70% ..."
 * ```
 */
export const buildLabSummaryText = (
  findings: LabResultRow[],
  date: string,
  time: string
): string => {
  // Normalize names first
  const normalized = findings.map(f => ({
    ...f,
    analysis: normalizeAnalysisName(f.analysis),
  }));

  // Build ordered summary parts — follow SUMMARY_ABBREVIATIONS order
  const parts: string[] = [];
  const used = new Set<string>();

  for (const [pattern, config] of SUMMARY_ABBREVIATIONS) {
    const finding = normalized.find(f => {
      if (used.has(f.analysis)) return false;
      return f.analysis.toLowerCase().includes(pattern.toLowerCase());
    });

    if (finding && !finding.qualitative) {
      used.add(finding.analysis);
      parts.push(formatSummaryValue(finding, config));
    }
  }

  const timeShort = time.substring(0, 5); // HH:MM
  const summaryParts = parts.length > 0 ? parts : buildFallbackSummaryParts(findings);

  if (summaryParts.length === 0) return '';

  return `Laboratorio (${date} ${timeShort}): ${summaryParts.join(' ')}`;
};
