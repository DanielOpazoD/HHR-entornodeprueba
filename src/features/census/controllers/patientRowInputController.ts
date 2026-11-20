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

/**
 * Who a row's data is, for its save scope. Only an accredited episode identifies a patient: a
 * `legacy_ep_` id, a document or a name can be corrected on the same patient, and a provisional
 * newborn's legacy id even changes when its own name is saved. Without one the row keeps the scope
 * it had before episodes were used here: a crib row none, a bed row its document or name and
 * admission (ID-05 lists the limit).
 */
const patientScopeIdentity = (data: PatientData | undefined, isSubRow: boolean): unknown[] => {
  const episode = resolveAccreditedClinicalEpisodeId(data);
  if (episode) return [episode];
  if (isSubRow) return [];
  return [
    data?.clinicalEpisodeId || data?.rut,
    data?.clinicalEpisodeId ? undefined : data?.patientName,
    data?.admissionDate,
    data?.admissionTime,
  ];
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
  JSON.stringify([
    date,
    bedId,
    isSubRow ? 'clinicalCrib' : 'bed',
    ...patientScopeIdentity(data, isSubRow),
  ]);

/**
 * The mother a crib row belongs to, when her episode is accredited. Two provisional newborns of
 * different mothers can carry the same name and admission; keying the crib row by its mother makes
 * a new mother in the bed a new crib row, so nothing typed for the previous newborn is sent
 * (ID-03, ID-05). A mother without an accredited episode adds nothing: correcting her document or
 * name must not drop what is being typed for her newborn.
 */
export const buildClinicalCribScopeOwner = (mother: PatientData): string | undefined =>
  resolveAccreditedClinicalEpisodeId(mother);
