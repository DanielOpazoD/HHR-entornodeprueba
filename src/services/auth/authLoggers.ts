import { createScopedLoggerMap } from '@/services/utils/loggerScope';

export const { authClaimSyncLogger, authRoleCacheLogger, firebaseStartupWarningLogger } =
  createScopedLoggerMap({
    authClaimSyncLogger: 'AuthClaimSync',
    authRoleCacheLogger: 'AuthRoleCache',
    firebaseStartupWarningLogger: 'FirebaseStartupWarningRenderer',
  });
