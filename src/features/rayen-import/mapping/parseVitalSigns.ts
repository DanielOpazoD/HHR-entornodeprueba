/**
 * Parser for the latest vital signs from Ficha Médico's `VITAL_SIGNS` forms (encounter-form-entry
 * endpoint — the SAME feed as the nursing scales, now fetched with the "all forms" filter). Each form
 * is one measurement; its `metaCampList` carries the readings keyed by stable Rayen field ids:
 *
 *   global_PASSent / global_PADSent · global_Pulso · exa_Fisic_G_SaturacionO2 · global_TempAxilar ·
 *   exa_Fisic_Frecuencia_Respiratoria · global_EscalaDolorEVA · global_Observaciones
 *
 * The day (`recordedDate`, Rapa Nui) and stamp come from `effectiveWhen` — shared with the scales
 * parser so the timezone handling is identical (offset-aware, see parseEvaluationScales). Forms marked
 * archived (superseded) or with no readings at all are skipped. Confirmed against real records (encId
 * 141180): a "Examen Fisico SAPU" VITAL_SIGNS form with PA 130/82, FC 84, SatO₂ 98, T° 36, FR 18, EVA 3.
 */

import { effectiveWhen, type RawForm, type RawCampo } from './parseEvaluationScales';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

const str = (value: unknown): string => (value == null ? '' : String(value)).trim();

/** Parse a numeric reading; blank / non-numeric → null (never let Number('') become 0). */
const num = (raw: string): number | null => {
  const value = raw.trim();
  if (value === '') return null;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Rayen field ids per reading, most-preferred first (matched case-insensitively). */
const FIELD_IDS = {
  systolic: ['global_PASSent'],
  diastolic: ['global_PADSent'],
  heartRate: ['global_Pulso'],
  spo2: ['exa_Fisic_G_SaturacionO2'],
  temperature: ['global_TempAxilar', 'Global_TempBucal', 'global_TempOido', 'global_TempRectal'],
  respiratoryRate: ['exa_Fisic_Frecuencia_Respiratoria'],
  painEva: ['global_EscalaDolorEVA'],
} as const;
const OBS_IDS = ['global_Observaciones'];
/** Clinical measurement time recorded inside the form (falls back to the form stamp for `recordedAt`). */
const TIME_IDS = ['SIGNS_FechaHora', 'global_FechaHoraSapu'];

/** Parse every `VITAL_SIGNS` form into a vitals record, sorted most-recent-first by event id. */
export const parseVitalSigns = (raw: unknown): PatientVitalSigns[] => {
  const forms: RawForm[] = Array.isArray(raw) ? (raw as RawForm[]) : [];
  const parsed: Array<{ key: number; record: PatientVitalSigns }> = [];

  for (const form of forms) {
    if (!form) continue;
    if (str(form.formCodigo).toUpperCase() !== 'VITAL_SIGNS') continue;
    if (form.archived === true) continue; // superseded measurement

    const campos: RawCampo[] = Array.isArray(form.metaCampList)
      ? (form.metaCampList as RawCampo[])
      : [];
    const byId = new Map<string, string>();
    for (const campo of campos) {
      const id = str(campo.id).toLowerCase();
      if (id && !byId.has(id)) byId.set(id, str(campo.value));
    }
    const get = (ids: readonly string[]): string => {
      for (const id of ids) {
        const value = byId.get(id.toLowerCase());
        if (value != null && value !== '') return value;
      }
      return '';
    };

    const when = effectiveWhen(form, campos);
    if (!when.iso) continue;

    const record: PatientVitalSigns = {
      recordedDate: when.iso,
      recordedAt: get(TIME_IDS) || when.raw,
      systolic: num(get(FIELD_IDS.systolic)),
      diastolic: num(get(FIELD_IDS.diastolic)),
      heartRate: num(get(FIELD_IDS.heartRate)),
      spo2: num(get(FIELD_IDS.spo2)),
      temperature: num(get(FIELD_IDS.temperature)),
      respiratoryRate: num(get(FIELD_IDS.respiratoryRate)),
      painEva: num(get(FIELD_IDS.painEva)),
      observations: get(OBS_IDS) || null,
      author: str(form.authorHealthCarePractitionerName),
      authorRole: str(form.authorHealthCarePractitionerRoleName),
    };

    // Skip a VITAL_SIGNS form that carries no actual readings (only a timestamp / observation).
    const hasReading =
      record.systolic != null ||
      record.diastolic != null ||
      record.heartRate != null ||
      record.spo2 != null ||
      record.temperature != null ||
      record.respiratoryRate != null ||
      record.painEva != null;
    if (!hasReading) continue;

    parsed.push({ key: Number(form.encounterEventId) || 0, record });
  }

  return parsed.sort((a, b) => b.key - a.key).map(entry => entry.record);
};

/**
 * The vitals the census should show for `censusIsoDay`: the most recent measurement recorded ON OR
 * BEFORE that day (a late sync of a PAST census never picks up vitals taken later). `parseVitalSigns`
 * already returns records most-recent-first, so the first one within range is the answer.
 */
export const latestVitalsAsOf = (
  records: PatientVitalSigns[],
  censusIsoDay: string
): PatientVitalSigns | null => records.find(record => record.recordedDate <= censusIsoDay) ?? null;
