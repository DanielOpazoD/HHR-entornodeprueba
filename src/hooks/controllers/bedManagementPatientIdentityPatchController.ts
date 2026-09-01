import type { PatientData } from '@/hooks/contracts/patientHookContracts';

const hasMeaningfulIdentityValue = (value?: string): boolean => Boolean(value?.trim());

const normalizeIdentityValue = (value?: string): string => String(value || '').trim();

export const hasDisplayablePatientName = (
  patient: Pick<PatientData, 'patientName'> | null | undefined
): boolean => hasMeaningfulIdentityValue(patient?.patientName);

export const shouldAnchorFirstSeenDate = ({
  currentPatientName,
  currentRut,
  nextPatientName,
  nextRut,
}: {
  currentPatientName?: string;
  currentRut?: string;
  nextPatientName?: string;
  nextRut?: string;
  currentFirstSeenDate?: string;
}): boolean => {
  const hadIdentity =
    hasMeaningfulIdentityValue(currentPatientName) || hasMeaningfulIdentityValue(currentRut);
  const hasIdentityNow =
    hasMeaningfulIdentityValue(nextPatientName) || hasMeaningfulIdentityValue(nextRut);

  // Empty identity means a new episode, even if a remote partial clear left a stale anchor behind.
  return !hadIdentity && hasIdentityNow;
};

export const shouldResetClinicalEpisodeOwnership = ({
  currentClinicalEpisodeId,
  currentPatientName,
  currentRut,
  nextPatientName,
  nextRut,
}: {
  currentClinicalEpisodeId?: string;
  currentPatientName?: string;
  currentRut?: string;
  nextPatientName?: string;
  nextRut?: string;
}): boolean => {
  if (!normalizeIdentityValue(currentClinicalEpisodeId)) {
    return false;
  }

  const normalizedCurrentRut = normalizeIdentityValue(currentRut);
  const normalizedNextRut = normalizeIdentityValue(nextRut);
  if ((normalizedCurrentRut || normalizedNextRut) && normalizedCurrentRut !== normalizedNextRut) {
    return true;
  }

  const normalizedCurrentName = normalizeIdentityValue(currentPatientName);
  const normalizedNextName = normalizeIdentityValue(nextPatientName);
  return (
    !normalizedCurrentRut &&
    !normalizedNextRut &&
    Boolean(normalizedCurrentName || normalizedNextName) &&
    normalizedCurrentName !== normalizedNextName
  );
};

/**
 * ¿La cama pasa a hospedar a OTRA persona? Con RUT en ambos lados, manda el
 * RUT: corregir un nombre o apellido del MISMO paciente no es un reemplazo.
 * El heurístico anterior («cualquier cambio de nombre = paciente nuevo»)
 * disparaba la limpieza clínica completa de la cama —diagnóstico incluido—
 * al editar Datos Demográficos, y el bedTypeOverrides de esa limpieza volvía
 * mixto el guardado, que la separación de autoridades rechazaba entero.
 */
export const isDifferentPatientIdentity = ({
  currentPatientName,
  currentRut,
  nextPatientName,
  nextRut,
}: {
  currentPatientName?: string;
  currentRut?: string;
  nextPatientName?: string;
  nextRut?: string;
}): boolean => {
  const normalizedCurrentRut = normalizeIdentityValue(currentRut);
  const normalizedNextRut = normalizeIdentityValue(nextRut);
  if (normalizedCurrentRut && normalizedNextRut) {
    return normalizedCurrentRut !== normalizedNextRut;
  }
  if (normalizedCurrentRut || normalizedNextRut) {
    return true;
  }
  const normalizedCurrentName = normalizeIdentityValue(currentPatientName);
  const normalizedNextName = normalizeIdentityValue(nextPatientName);
  return (
    Boolean(normalizedCurrentName || normalizedNextName) &&
    normalizedCurrentName !== normalizedNextName
  );
};

export const getClearClinicalDataPatches = (bedId: string): Record<string, unknown> => ({
  [`beds.${bedId}.cie10Code`]: undefined,
  [`beds.${bedId}.cie10Description`]: undefined,
  [`beds.${bedId}.pathology`]: '',
  [`beds.${bedId}.clinicalEvents`]: [],
  [`beds.${bedId}.cudyr`]: undefined,
  [`beds.${bedId}.isUPC`]: false,
  [`beds.${bedId}.upcChecklist`]: undefined,
  [`beds.${bedId}.deviceDetails`]: {},
  [`beds.${bedId}.devices`]: [],
  [`beds.${bedId}.handoffNoteDayShift`]: '',
  [`beds.${bedId}.handoffNoteNightShift`]: '',
  [`beds.${bedId}.medicalHandoffNote`]: '',
  [`beds.${bedId}.medicalHandoffAudit`]: undefined,
  [`beds.${bedId}.medicalHandoffEntries`]: [],
  [`beds.${bedId}.ginecobstetriciaType`]: undefined,
  [`beds.${bedId}.deliveryRoute`]: undefined,
  [`beds.${bedId}.deliveryDate`]: undefined,
  [`beds.${bedId}.deliveryCesareanLabor`]: undefined,
  [`bedTypeOverrides.${bedId}`]: undefined,
});
