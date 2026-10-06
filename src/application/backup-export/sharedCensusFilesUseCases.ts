import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import {
  defaultCensusAccessPort,
  type CensusAccessPort,
} from '@/application/ports/censusAccessPort';
import type { StoredCensusFile } from '@/services/backup/censusStorageService';
import { executeLoadSharedCensusFilesController } from './sharedCensusFilesController';
import type { CensusAccessLog } from '@/types/censusAccess';

export interface SharedCensusFilesPort {
  listFilesInMonth: (year: string, month: string) => Promise<StoredCensusFile[]>;
}

export const defaultSharedCensusFilesPort: SharedCensusFilesPort = {
  listFilesInMonth: async (year, month) => {
    const { listCensusFilesInMonth } = await import('@/services/backup/censusStorageService');
    return listCensusFilesInMonth(year, month);
  },
};

interface SharedCensusFilesUseCaseDependencies {
  sharedCensusFilesPort?: SharedCensusFilesPort;
  censusAccessPort?: Pick<CensusAccessPort, 'logAccess'>;
}

export const executeLoadSharedCensusFiles = async (
  now: Date,
  dependencies: SharedCensusFilesUseCaseDependencies = {}
): Promise<ApplicationOutcome<StoredCensusFile[]>> => {
  const sharedCensusFilesPort = dependencies.sharedCensusFilesPort || defaultSharedCensusFilesPort;

  const result = await executeLoadSharedCensusFilesController({
    now,
    listFilesInMonth: sharedCensusFilesPort.listFilesInMonth,
  });

  if (!result.ok) {
    return createApplicationFailed([], [{ kind: 'unknown', message: result.error.message }]);
  }

  return createApplicationSuccess(result.value.files);
};

export const executeLogSharedCensusAccess = async (
  config: Omit<CensusAccessLog, 'id' | 'timestamp'>,
  dependencies: SharedCensusFilesUseCaseDependencies = {}
): Promise<void> => {
  const censusAccessPort = dependencies.censusAccessPort || defaultCensusAccessPort;
  await censusAccessPort.logAccess(config);
};
