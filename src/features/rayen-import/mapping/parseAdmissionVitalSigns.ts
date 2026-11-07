import { FIELD_IDS, INSULIN_QUADRANT_IDS, parseVitalSigns } from './parseVitalSigns';
import { encounterWallClockInRapaNui } from './encounterWallClock';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

const numericIds = new Set(
  Object.values(FIELD_IDS)
    .flat()
    .map(id => id.toLowerCase())
);
const quadrantIds = new Set(INSULIN_QUADRANT_IDS.map(id => id.toLowerCase()));
const object = (raw: unknown): Record<string, unknown> | null =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;

/** Audit coverage: a discarded undated measurement must not make a later take appear first. */
export const parseAdmissionVitalSigns = (
  forms: unknown[]
): {
  vitals: PatientVitalSigns[];
  unverifiableTime: boolean;
} => {
  const vitals: PatientVitalSigns[] = [];
  let unverifiableTime = false;
  for (const raw of forms) {
    const form = object(raw);
    if (!form) {
      unverifiableTime = true;
      continue;
    }
    if (
      String(form.formCodigo ?? '')
        .trim()
        .toUpperCase() !== 'VITAL_SIGNS' ||
      form.archived === true
    )
      continue;
    if (!Array.isArray(form.metaCampList) || form.metaCampList.some(campo => !object(campo))) {
      unverifiableTime = true;
      continue;
    }
    const parsed = parseVitalSigns([form]);
    const hasReading =
      Array.isArray(form.metaCampList) &&
      form.metaCampList.some(rawCampo => {
        const campo = object(rawCampo);
        const id = String(campo?.id ?? '').toLowerCase();
        const value = String(campo?.value ?? '').trim();
        return value !== '' && (numericIds.has(id) || quadrantIds.has(id));
      });
    if (
      hasReading &&
      (!parsed.length ||
        parsed.some(
          v =>
            !encounterWallClockInRapaNui(v.recordedAt) || !/[T\s]\d{1,2}:\d{2}/.test(v.recordedAt)
        ))
    )
      unverifiableTime = true;
    vitals.push(...parsed);
  }
  return { vitals, unverifiableTime };
};
