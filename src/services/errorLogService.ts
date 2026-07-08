import {
  clearErrorLogs as clearIndexedDbErrorLogs,
  getErrorLogs,
} from '@/services/storage/indexeddb/indexedDbErrorLogService';

export const fetchErrorLogs = async (limit = 50) => getErrorLogs(limit);

export const clearErrorLogs = async () => clearIndexedDbErrorLogs();
