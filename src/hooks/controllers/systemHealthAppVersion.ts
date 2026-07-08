import { CURRENT_SCHEMA_VERSION } from '@/constants/version';
import { BACKEND_RUNTIME_CONTRACT_VERSION } from '@/constants/runtimeContracts';
import { resolveDailyRecordAuthorityMode } from '@/services/storage/firestore/dailyRecordAuthorityMode';

export const buildSystemHealthAppVersion = (syncBatchSize: number): string =>
  `v${CURRENT_SCHEMA_VERSION} (sync-batch:${syncBatchSize}, backend-contract:${BACKEND_RUNTIME_CONTRACT_VERSION}, authority:${resolveDailyRecordAuthorityMode()})`;
