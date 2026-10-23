import {
  getFirebaseStartupFailureMessage,
  type FirebaseStartupWarningCopy,
} from '@/services/auth/firebaseStartupUiPolicy';
import {
  prepareClientBootstrap,
  type ClientBootstrapRecoveryResult,
} from '@/services/config/clientBootstrapRecovery';
import { shouldUseStickyIndexedDbFallback } from '@/services/storage/indexeddb/indexedDbRecoveryPolicy';
import { repairClientStorageKeepingPendingWork } from '@/services/storage/indexeddb/indexedDbMaintenanceService';
import { defaultFirebaseConfigRuntimeAdapter } from '@/services/firebase-runtime/firebaseConfigRuntimeAdapter';
import { createScopedLogger } from '@/services/utils/loggerScope';
import type {
  AppBootstrapRuntimeResult,
  BootstrapRuntimeServices,
} from '@/app-shell/bootstrap/bootstrapAppRuntime.types';

const bootstrapRuntimeLogger = createScopedLogger('BootstrapRuntime');
export const BOOTSTRAP_STORAGE_REPAIR_KEY = 'hhr_bootstrap_storage_repair_v1';

const getErrorMessage = (error: unknown): string =>
  error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);

const canUseSessionStorage = (): boolean => typeof sessionStorage !== 'undefined';

const hasAttemptedStorageRepair = (): boolean =>
  canUseSessionStorage() && sessionStorage.getItem(BOOTSTRAP_STORAGE_REPAIR_KEY) === '1';

const markStorageRepairAttempt = (): void => {
  if (!canUseSessionStorage()) {
    return;
  }

  sessionStorage.setItem(BOOTSTRAP_STORAGE_REPAIR_KEY, '1');
};

const clearStorageRepairAttempt = (): void => {
  if (!canUseSessionStorage()) {
    return;
  }

  sessionStorage.removeItem(BOOTSTRAP_STORAGE_REPAIR_KEY);
};

const isIndexedDbBootstrapFailure = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase();
  return (
    shouldUseStickyIndexedDbFallback(error) ||
    message.includes('indexeddb.open') ||
    message.includes('backing store') ||
    message.includes('internal error opening backing store')
  );
};

const isLocalStorageBootstrapFailure = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase();
  return (
    isIndexedDbBootstrapFailure(error) ||
    message.includes('firebase initialization timed out') ||
    message.includes('auth persistence') ||
    message.includes('local storage') ||
    message.includes('session storage') ||
    message.includes('quotaexceedederror')
  );
};

const getLocalStorageBootstrapWarningCopy = (): FirebaseStartupWarningCopy => ({
  title: 'Problema local del navegador',
  summary:
    'La app no pudo iniciar correctamente por un problema en el almacenamiento local de este navegador. La configuración de Firebase del entorno no parece ser la causa principal.',
  steps: [
    'Se recomienda limpiar los datos locales de este sitio y volver a cargar la aplicación.',
    'Limpiar los datos del sitio borra también los cambios que aún no se sincronizaron desde este equipo. Si alguien trabajó sin conexión aquí, avisa antes al administrador.',
    'Si el problema ocurre solo en una sesión antigua y en incógnito funciona, el origen es casi siempre almacenamiento local dañado o un estado viejo del navegador.',
    'Si también falla en incógnito o en otros navegadores, recién ahí revisar variables y runtime en Netlify.',
  ],
  footnote:
    'Este aviso apunta a recuperación local del navegador, no a una falta confirmada de variables Firebase.',
});

type BootstrapFailureResolution =
  | {
      action: 'repair_reload';
    }
  | {
      action: 'blocked';
      warningCopy?: FirebaseStartupWarningCopy;
      messageOverride?: string;
    };

export const resolveBootstrapFailureResolution = (
  error: unknown,
  hasStorageRepairAttempted: boolean
): BootstrapFailureResolution => {
  if (isLocalStorageBootstrapFailure(error) && !hasStorageRepairAttempted) {
    return {
      action: 'repair_reload',
    };
  }

  if (isLocalStorageBootstrapFailure(error)) {
    return {
      action: 'blocked',
      warningCopy: getLocalStorageBootstrapWarningCopy(),
      messageOverride: 'No se pudo iniciar correctamente por un problema local del navegador.',
    };
  }

  return {
    action: 'blocked',
  };
};

const resolveBlockedBootstrapResult = (
  clientRecovery: ClientBootstrapRecoveryResult,
  error: unknown,
  warningCopy?: FirebaseStartupWarningCopy,
  messageOverride?: string
): AppBootstrapRuntimeResult => {
  const message = messageOverride || getFirebaseStartupFailureMessage();
  bootstrapRuntimeLogger.error('Firebase bootstrap failed', error);
  return {
    status: 'blocked',
    stage: 'firebase_ready',
    clientRecovery,
    error,
    message,
    warningCopy,
  };
};

export const reconcileBootstrapRuntime = async (): Promise<ClientBootstrapRecoveryResult> =>
  prepareClientBootstrap();

export const resolveFirebaseBootstrapRuntime = async (
  clientRecovery: ClientBootstrapRecoveryResult
): Promise<AppBootstrapRuntimeResult> => {
  if (clientRecovery.status === 'reload') {
    bootstrapRuntimeLogger.warn('Bootstrap paused for recovery reload', {
      reason: clientRecovery.reason,
    });
    return {
      status: 'reload',
      stage: 'client_recovery',
      clientRecovery,
    };
  }

  try {
    await defaultFirebaseConfigRuntimeAdapter.ready;
    const services: BootstrapRuntimeServices = {
      app: defaultFirebaseConfigRuntimeAdapter.getApp(),
      auth: defaultFirebaseConfigRuntimeAdapter.getAuth(),
      db: defaultFirebaseConfigRuntimeAdapter.getOptionalDb(),
    };
    bootstrapRuntimeLogger.info('Bootstrap runtime ready', {
      recoveryReason: clientRecovery.reason,
      firestoreReady: Boolean(services.db),
    });
    clearStorageRepairAttempt();
    return {
      status: 'continue',
      stage: 'firebase_ready',
      clientRecovery,
      services,
    };
  } catch (error) {
    const resolution = resolveBootstrapFailureResolution(error, hasAttemptedStorageRepair());

    if (resolution.action === 'repair_reload') {
      markStorageRepairAttempt();
      bootstrapRuntimeLogger.warn(
        'Detected local browser storage corruption during bootstrap; repairing without touching pending work'
      );
      await repairClientStorageKeepingPendingWork();
      return {
        status: 'reload',
        stage: 'firebase_ready',
        clientRecovery,
      };
    }

    return resolveBlockedBootstrapResult(
      clientRecovery,
      error,
      resolution.warningCopy,
      resolution.messageOverride
    );
  }
};

export const bootstrapAppRuntime = async (): Promise<AppBootstrapRuntimeResult> => {
  const clientRecovery = await reconcileBootstrapRuntime();
  return resolveFirebaseBootstrapRuntime(clientRecovery);
};
