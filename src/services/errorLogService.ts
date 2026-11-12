import type { UserRole } from '@/types/authRoleTypes';
import {
  clearErrorLogs as clearIndexedDbErrorLogs,
  getErrorLogs,
} from '@/services/storage/indexeddb/indexedDbErrorLogService';

export const fetchErrorLogs = async (limit = 50, role?: UserRole) => getErrorLogs(limit, role);

export const clearErrorLogs = async (role?: UserRole) => clearIndexedDbErrorLogs(role);
