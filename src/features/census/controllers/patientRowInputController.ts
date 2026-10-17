import type {
  CesareanLabor,
  DeliveryRoute,
} from '@/features/census/contracts/censusObstetricContracts';
import type {
  PatientData,
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

/** Scope unsent drafts and UI feedback to one census occupant, including legacy records. */
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
    data?.clinicalEpisodeId || data?.rut,
    data?.clinicalEpisodeId ? undefined : data?.patientName,
    data?.admissionDate,
    data?.admissionTime,
  ]);
