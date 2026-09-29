import type { PatientData } from '@/hooks/contracts/patientHookContracts';
import { normalizeRut } from '@/utils/rutUtils';

const hasMeaningfulIdentityValue = (value?: string): boolean => Boolean(value?.trim());

const normalizeIdentityValue = (value?: string): string => String(value || '').trim();

// Formatting a RUT must not start a new episode. Passport identifiers retain their
// exact trimmed form; stripping non-numeric characters would merge distinct IDs.
const normalizeDocumentIdentity = (
  value?: string,
  documentType?: PatientData['documentType']
): string => {
  const trimmed = normalizeIdentityValue(value);
  return documentType !== 'Pasaporte' && /^\d[\d.\s-]*[\dkK]$/.test(trimmed)
    ? normalizeRut(trimmed)
    : trimmed;
};

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
  currentDocumentType,
  nextDocumentType,
}: {
  currentClinicalEpisodeId?: string;
  currentPatientName?: string;
  currentRut?: string;
  nextPatientName?: string;
  nextRut?: string;
  currentDocumentType?: PatientData['documentType'];
  nextDocumentType?: PatientData['documentType'];
}): boolean => {
  if (!normalizeIdentityValue(currentClinicalEpisodeId)) {
    return false;
  }

  const normalizedCurrentRut = normalizeDocumentIdentity(currentRut, currentDocumentType);
  const normalizedNextRut = normalizeDocumentIdentity(
    nextRut,
    nextDocumentType ?? currentDocumentType
  );
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
  currentDocumentType,
  nextDocumentType,
}: {
  currentPatientName?: string;
  currentRut?: string;
  nextPatientName?: string;
  nextRut?: string;
  currentDocumentType?: PatientData['documentType'];
  nextDocumentType?: PatientData['documentType'];
}): boolean => {
  const normalizedCurrentRut = normalizeDocumentIdentity(currentRut, currentDocumentType);
  const normalizedNextRut = normalizeDocumentIdentity(
    nextRut,
    nextDocumentType ?? currentDocumentType
  );
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
  [`beds.${bedId}.specialty`]: '',
  [`beds.${bedId}.specialtyAssignment`]: undefined,
  [`beds.${bedId}.cie10Code`]: undefined,
  [`beds.${bedId}.cie10Description`]: undefined,
  [`beds.${bedId}.pathology`]: '',
  [`beds.${bedId}.treatingPhysicianId`]: undefined,
  [`beds.${bedId}.treatingPhysicianName`]: undefined,
  [`beds.${bedId}.dismissedTreatingPhysician`]: undefined,
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
