import { getErrorLogs, clearErrorLogs } from './storage/indexedDBService';

export const fetchErrorLogs = async (limit = 50) => getErrorLogs(limit);

export const purgeErrorLogs = async () => clearErrorLogs();
