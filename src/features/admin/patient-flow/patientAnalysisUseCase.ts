import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import type { PatientMasterWritePort } from '@/application/ports/patientMasterPort';
import type { AuditPort } from '@/application/ports/auditPort';
import {
  buildPatientAnalysis,
  harmonizePatientConflictHistory,
  resolveUpdatedAnalysisAfterConflict,
  type AnalysisResult,
  type Conflict,
  type PatientAnalysisDailyRecordRepository,
} from '@/features/admin/patient-flow/patientAnalysisSupport';

export type {
  AnalysisResult,
  Conflict,
} from '@/features/admin/patient-flow/patientAnalysisSupport';

interface AnalyzePatientsInput {
  dailyRecordRepository: PatientAnalysisDailyRecordRepository;
}

interface ResolvePatientConflictInput {
  analysis: AnalysisResult | null;
  rut: string;
  correctName: string;
  harmonizeHistory: boolean;
  dailyRecordRepository: PatientAnalysisDailyRecordRepository;
  auditPort: Pick<AuditPort, 'writeEvent'>;
  currentUserEmail: string;
}

interface MigratePatientsInput {
  analysis: AnalysisResult | null;
  patientMasterRepository: PatientMasterWritePort;
}

const createUnknownFailure = <T>(
  error: unknown,
  fallbackMessage: string
): ApplicationOutcome<T | null> =>
  createApplicationFailed(null, [
    {
      kind: 'unknown',
      message: error instanceof Error ? error.message : fallbackMessage,
    },
  ]);

const resolveConflict = (analysis: AnalysisResult | null, rut: string): Conflict | undefined =>
  analysis?.conflicts.find(item => item.rut === rut);

export const executeAnalyzePatients = async (
  input: AnalyzePatientsInput
): Promise<ApplicationOutcome<AnalysisResult | null>> => {
  try {
    const analysis = await buildPatientAnalysis(input.dailyRecordRepository);
    return createApplicationSuccess(analysis);
  } catch (error) {
    return createUnknownFailure(error, 'No se pudo analizar pacientes.');
  }
};

export const executeResolvePatientConflict = async (
  input: ResolvePatientConflictInput
): Promise<ApplicationOutcome<AnalysisResult | null>> => {
  if (!input.analysis) {
    return createApplicationSuccess(null);
  }

  const conflict = resolveConflict(input.analysis, input.rut);
  if (!conflict) {
    return createApplicationSuccess(input.analysis);
  }

  if (input.harmonizeHistory) {
    await harmonizePatientConflictHistory({
      conflict,
      dailyRecordRepository: input.dailyRecordRepository,
      auditPort: input.auditPort,
      currentUserEmail: input.currentUserEmail,
      rut: input.rut,
      correctName: input.correctName,
    });
  }

  return createApplicationSuccess(
    resolveUpdatedAnalysisAfterConflict({
      analysis: input.analysis,
      rut: input.rut,
      correctName: input.correctName,
    })
  );
};

export const executeMigratePatients = async (
  input: MigratePatientsInput
): Promise<
  ApplicationOutcome<{
    successes: number;
    errors: number;
  } | null>
> => {
  if (!input.analysis || input.analysis.validPatients.length === 0) {
    return createApplicationSuccess(null);
  }

  try {
    const result = await input.patientMasterRepository.bulkUpsertPatients(
      input.analysis.validPatients
    );
    return createApplicationSuccess(result);
  } catch (error) {
    return createUnknownFailure(error, 'No se pudo migrar la base de pacientes.');
  }
};
