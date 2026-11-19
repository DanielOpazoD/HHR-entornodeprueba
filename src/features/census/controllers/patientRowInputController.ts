import type { CesareanLabor, DeliveryRoute, PatientData } from '@/types/domain/patient';

import { resolveAccreditedClinicalEpisodeId } from '@/domain/clinical-episode/clinicalEpisodeIdPolicy';
import type {
  PatientRowDeliveryPatch,
  PatientRowPatientDocumentType,
} from '@/features/census/components/patient-row/patientRowContracts';

export const resolveNextDocumentType = (
  currentType: PatientRowPatientDocumentType | undefined
): NonNullable<PatientRowPatientDocumentType> =>
  currentType === 'Pasaporte' ? 'RUT' : 'Pasaporte';

export const buildDeliveryRoutePatch = (
  route: DeliveryRoute | undefined,
  date: string | undefined,
  cesareanLabor: CesareanLabor | undefined
): PatientRowDeliveryPatch => ({
  deliveryRoute: route,
  deliveryDate: date,
  deliveryCesareanLabor: route === 'Cesárea' ? cesareanLabor : undefined,
});

/** Who a row's data is: its accredited episode, or for records without one (a `legacy_ep_` id
 * identifies no one) its document, name and admission. */
const patientScopeIdentity = (data: PatientData | undefined): unknown[] => {
  const episode = resolveAccreditedClinicalEpisodeId(data);
  return episode
    ? [episode]
    : [data?.rut, data?.patientName, data?.admissionDate, data?.admissionTime];
};

/**
 * Scope unsent drafts and UI feedback to one census occupant (ID-05): it changes only when the
 * occupant is replaced. The episode id names the hospitalization, so correcting that episode's
 * admission date or time keeps the scope.
 */
export const buildPatientRowSaveScopeKey = (
  date: string | undefined,
  data: PatientData | undefined,
  bedId = data?.bedId,
  isSubRow = false
): string =>
  JSON.stringify([date, bedId, isSubRow ? 'clinicalCrib' : 'bed', ...patientScopeIdentity(data)]);

/**
 * The bed's patient a crib row belongs to. Two provisional newborns of different mothers can carry
 * the same name and admission; the crib row is keyed by its mother so that a new mother in the bed
 * is a new crib row, and nothing typed for the previous newborn is sent (ID-03, ID-05).
 */
export const buildClinicalCribScopeOwner = (mother: PatientData): string =>
  JSON.stringify(patientScopeIdentity(mother));
