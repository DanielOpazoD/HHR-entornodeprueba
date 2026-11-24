import type { ChecklistRecord } from '@/services/clinical-checklists/checklistService';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import type { ClinicalFormValues } from './clinicalFormTypes';

const MAX_BRADEN_PDF_ROWS = 14;

const FIELD_TO_COLUMN = new Map<string, string>([
  ['percepcion', 'ps'],
  ['humedad', 'h'],
  ['actividad', 'a'],
  ['movilidad', 'm'],
  ['nutricion', 'n'],
  ['friccion', 'f'],
  ['perfusion', 'po'],
]);

const SHORT_CODE_TO_COLUMN = new Map<string, string>([
  ['PS', 'ps'],
  ['H', 'h'],
  ['A', 'a'],
  ['M', 'm'],
  ['N', 'n'],
  ['F', 'f'],
  ['PO', 'po'],
]);

const RISK_TO_CODE = new Map<string, 'A' | 'M' | 'B'>([
  ['alto', 'A'],
  ['moderado', 'M'],
  ['bajo', 'B'],
]);

const extractLeadingPoints = (value: string): string | null => {
  const match = value.trim().match(/^([1-4])\s*·/);
  return match?.at(1) ?? null;
};

/**
 * Map persisted HHR Braden checklist applications (up to the latest 14) into the
 * fillable row fields of `pauta-braden-lpp.json`. Pure and read-only.
 */
export const mapBradenRecordsToClinicalFormValues = (
  records: ReadonlyArray<ChecklistRecord>
): ClinicalFormValues => {
  const values: ClinicalFormValues = {};
  const recent = records.slice(-MAX_BRADEN_PDF_ROWS);

  recent.forEach((record, index) => {
    const row = index + 1;
    const prefix = `braden_reg_${row}`;
    const rows = record.rows ?? [];

    const rowValue = (fieldId: string): string =>
      rows.find(item => item.field === fieldId)?.value?.trim() ?? '';

    const savedDate = record.savedAt ? new Date(record.savedAt) : null;
    const stamp =
      savedDate && !Number.isNaN(savedDate.getTime())
        ? calendarStampInClinicalTimeZone(savedDate)
        : null;

    const fecha = rowValue('fecha') || stamp?.iso || '';
    const hora = rowValue('hora') || stamp?.hhmm || '';
    if (fecha) values[`${prefix}_fecha`] = fecha;
    if (hora) values[`${prefix}_hora`] = hora;

    if (record.score?.subscores) {
      for (const [shortCode, points] of Object.entries(record.score.subscores)) {
        const col = SHORT_CODE_TO_COLUMN.get(shortCode);
        if (col && Number.isInteger(points)) values[`${prefix}_${col}`] = String(points);
      }
    }

    for (const item of rows) {
      const col =
        (item.shortCode ? SHORT_CODE_TO_COLUMN.get(item.shortCode) : undefined) ??
        FIELD_TO_COLUMN.get(item.field);
      if (!col || values[`${prefix}_${col}`]) continue;
      if (typeof item.points === 'number') {
        values[`${prefix}_${col}`] = String(item.points);
      } else {
        const parsed = extractLeadingPoints(item.value);
        if (parsed) values[`${prefix}_${col}`] = parsed;
      }
    }

    if (record.score && Number.isInteger(record.score.points)) {
      values[`${prefix}_total`] = String(record.score.points);
    }
    const riskCode = record.score?.risk ? RISK_TO_CODE.get(record.score.risk) : undefined;
    if (riskCode) values[`${prefix}_riesgo`] = riskCode;
    if (record.authorName?.trim()) values[`${prefix}_evaluador`] = record.authorName.trim();
  });

  return values;
};
