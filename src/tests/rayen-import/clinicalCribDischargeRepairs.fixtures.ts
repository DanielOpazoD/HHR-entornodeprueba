import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DischargeData } from '@/types/domain/movements';
import type { PatientData } from '@/types/domain/patient';

export const repairRecord = (): DailyRecord => {
  const crib = {
    ...EMPTY_PATIENT,
    bedId: 'H6C1',
    bedMode: 'Cuna' as const,
    patientName: 'RN sintético',
    rut: '111111111',
    clinicalEpisodeId: 'rn-episode',
    admissionDate: '2026-09-28',
    admissionTime: '10:00',
    pathology: 'Diagnóstico RN',
    specialty: 'Pediatría' as const,
  };
  const kept: DischargeData = {
    id: 'canonical-rn',
    movementDate: '2026-09-30',
    bedId: 'H6C1',
    bedName: 'H6C1 (Cuna RN)',
    bedType: 'Cuna',
    patientName: crib.patientName,
    rut: crib.rut,
    clinicalEpisodeId: crib.clinicalEpisodeId,
    admissionDate: crib.admissionDate,
    time: '11:21',
    status: 'Vivo',
    isNested: true,
    diagnosis: crib.pathology,
    originalData: crib,
    movementProvenance: {
      source: 'gestion_camas',
      lineageId: 'canonical-rn',
      syncRunId: 'old-sync',
      classifiedAt: '2026-09-30T18:00:00Z',
    },
  };
  const duplicate: DischargeData = {
    ...kept,
    id: 'sparse-rn',
    bedId: 'Cuna H6C1',
    bedName: 'Cuna H6C1 (Cuna RN)',
    admissionDate: undefined,
    movementProvenance: { ...kept.movementProvenance!, lineageId: 'sparse-rn' },
    originalData: {
      patientName: crib.patientName,
      rut: crib.rut,
      pathology: crib.pathology,
      clinicalEpisodeId: crib.clinicalEpisodeId,
      admissionDate: '',
      admissionTime: '',
    } as PatientData,
  };
  return {
    date: '2026-09-30',
    beds: {},
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: 'old',
    discharges: [
      kept,
      duplicate,
      {
        ...kept,
        id: 'mother',
        isNested: false,
        clinicalEpisodeId: 'mother-episode',
        originalData: { ...crib, clinicalEpisodeId: 'mother-episode' },
      },
    ],
  };
};
