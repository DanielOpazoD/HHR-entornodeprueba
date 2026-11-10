import { createCachedRuntimeLoader } from '@/services/runtime/createCachedRuntimeLoader';
import type { MasterPatient } from '@/types/domain/patientMaster';
import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import {
  isSearchMasterPatientsQueryTooLong,
  normalizeSearchMasterPatientsInput,
} from './searchMasterPatientsContracts';

const loadPatientMasterRepository = createCachedRuntimeLoader(
  () => import('@/services/repositories/PatientMasterRepository')
);

export const searchMasterPatients = async (
  searchTerm: string,
  limitCount: number = 20
): Promise<ApplicationOutcome<MasterPatient[]>> => {
  const normalizedInput = normalizeSearchMasterPatientsInput({ searchTerm, limitCount });
  if (!normalizedInput.searchTerm) return createApplicationSuccess([]);

  if (isSearchMasterPatientsQueryTooLong(normalizedInput.searchTerm)) {
    return createApplicationFailed(
      [],
      [
        {
          kind: 'validation',
          code: 'census/master-patient-search-invalid-query',
          message: 'Search query exceeds maximum supported length.',
          userSafeMessage: 'La búsqueda es demasiado larga. Intenta con menos texto.',
          retryable: true,
        },
      ],
      {
        reason: 'census_master_patient_search_invalid_query',
        userSafeMessage: 'La búsqueda es demasiado larga. Intenta con menos texto.',
        retryable: true,
        severity: 'info',
      }
    );
  }

  try {
    const repository = await loadPatientMasterRepository();
    const patients = await repository.searchPatients(
      normalizedInput.searchTerm,
      normalizedInput.limitCount
    );
    return createApplicationSuccess(patients);
  } catch (error) {
    return createApplicationFailed(
      [],
      [
        {
          kind: 'unknown',
          code: 'census/master-patient-search-failed',
          message: error instanceof Error ? error.message : 'Patient search failed',
          userSafeMessage: 'No se pudo consultar el índice de pacientes.',
          retryable: true,
        },
      ],
      {
        reason: 'census_master_patient_search_failed',
        userSafeMessage: 'No se pudo consultar el índice de pacientes.',
        retryable: true,
        severity: 'warning',
      }
    );
  }
};
