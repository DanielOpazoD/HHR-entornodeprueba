import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  createApplicationDegraded,
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome, UseCase } from '@/shared/contracts/applicationOutcomeTypes';

import type { DailyRecordInitializationResult } from '@/services/repositories/dailyRecordRepositoryInitializationService';
import {
  defaultDailyRecordReadPort,
  type DailyRecordReadPort,
} from '@/application/ports/dailyRecordPort';

export interface InitializeDailyRecordInput {
  date: string;
  copyFromDate?: string;
  repository?: Pick<DailyRecordReadPort, 'initializeDay'>;
}

export interface InitializeDailyRecordOutput {
  record: DailyRecord | null;
  initialization: DailyRecordInitializationResult | null;
}

const mapInitializationOutcome = (
  result: DailyRecordInitializationResult
): ApplicationOutcome<InitializeDailyRecordOutput> => {
  const data = {
    record: result.record,
    initialization: result,
  };

  if (result.outcome === 'repaired') {
    return createApplicationDegraded(data, [
      {
        kind: 'conflict',
        message: 'El día fue inicializado con reparación de compatibilidad heredada.',
        code: result.sourceCompatibilityIntensity,
      },
    ]);
  }

  return createApplicationSuccess(data);
};

const normalizeInitializationResult = (
  result: DailyRecordInitializationResult | DailyRecord
): DailyRecordInitializationResult => {
  if (result && typeof result === 'object' && 'record' in result && 'outcome' in result) {
    return result as DailyRecordInitializationResult;
  }

  const record = result as DailyRecord;
  return {
    outcome: 'clean',
    record,
    sourceDate: undefined,
    sourceCompatibilityIntensity: 'none',
    sourceMigrationRulesApplied: [],
  };
};

export class InitializeDailyRecordUseCase implements UseCase<
  InitializeDailyRecordInput,
  InitializeDailyRecordOutput
> {
  async execute(
    input: InitializeDailyRecordInput
  ): Promise<ApplicationOutcome<InitializeDailyRecordOutput>> {
    const repository = input.repository || defaultDailyRecordReadPort;
    try {
      const initialization = normalizeInitializationResult(
        (await repository.initializeDay(input.date, input.copyFromDate)) as
          | DailyRecordInitializationResult
          | DailyRecord
      );
      return mapInitializationOutcome(initialization);
    } catch (error) {
      return createApplicationFailed(
        {
          record: null as never,
          initialization: null as never,
        },
        [
          {
            kind: 'unknown',
            message: error instanceof Error ? error.message : 'No se pudo inicializar el día.',
          },
        ]
      );
    }
  }
}

export const executeInitializeDailyRecord = async (
  input: InitializeDailyRecordInput
): Promise<ApplicationOutcome<InitializeDailyRecordOutput>> =>
  new InitializeDailyRecordUseCase().execute(input);
