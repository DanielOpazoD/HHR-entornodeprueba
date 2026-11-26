import type { DiagnosisManualOverrideBase, PatientData } from '@/types/domain/patient';

export const normalizeDiagnosisTextForOverride = (value?: string): string =>
  (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export const normalizeDiagnosisCodeForOverride = (value?: string): string =>
  (value ?? '').trim().toUpperCase();

/** Captures the Eloísa diagnosis currently on the bed right before a manual edit starts. */
export const buildDiagnosisManualOverrideBase = (
  patient?: Pick<PatientData, 'pathology' | 'cie10Code'>
): DiagnosisManualOverrideBase => {
  const cie10Code = normalizeDiagnosisCodeForOverride(patient?.cie10Code);
  return {
    pathology: (patient?.pathology ?? '').trim(),
    ...(cie10Code ? { cie10Code } : {}),
  };
};

/**
 * True when Eloísa now reports a meaningfully different diagnosis from the one that was on the
 * bed when the manual edit started.
 *
 * - Legacy manual overrides (no stored baseline) stay protected until unlocked or episode change.
 * - An empty incoming diagnosis never supersedes a manual diagnosis.
 * - Coding the exact same text later (or transiently losing its code) does not supersede it.
 */
export const hasNewerSourceDiagnosisThanOverrideBase = (
  current: Pick<PatientData, 'diagnosisManualOverride' | 'diagnosisManualOverrideBase'>,
  incoming: Pick<PatientData, 'pathology' | 'cie10Code'>
): boolean => {
  if (current.diagnosisManualOverride !== true) return false;
  const base = current.diagnosisManualOverrideBase;
  if (!base) return false;

  const incomingText = normalizeDiagnosisTextForOverride(incoming.pathology);
  if (!incomingText) return false;

  const baseText = normalizeDiagnosisTextForOverride(base.pathology);
  if (incomingText !== baseText) return true;

  const baseCode = normalizeDiagnosisCodeForOverride(base.cie10Code);
  const incomingCode = normalizeDiagnosisCodeForOverride(incoming.cie10Code);
  return Boolean(baseCode && incomingCode && incomingCode !== baseCode);
};

/** Patch fields that lift a manual diagnosis lock without erasing the displayed text. */
export const buildRestoreEloisaDiagnosisPatch = (): Pick<
  PatientData,
  'diagnosisManualOverride' | 'diagnosisManualOverrideBase'
> => ({
  diagnosisManualOverride: undefined,
  diagnosisManualOverrideBase: undefined,
});
