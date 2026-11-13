import {
  isModuleReloadRequired,
  setModuleReloadRequired,
  subscribeModuleRecovery,
} from '@/services/runtime/moduleReloadRecovery';
import { isChunkLoadError } from '@/utils/chunkLoadError';

export const FUNCTIONS_RELOAD_REQUIRED_MESSAGE =
  'Recarga la aplicación para restablecer el acceso. Los cambios pendientes se conservan.';

export const isFunctionsReloadRequired = () => isModuleReloadRequired('functions');
export const subscribeFunctionsRecovery = subscribeModuleRecovery;
const setReloadRequired = (value: boolean) => setModuleReloadRequired('functions', value);

/**
 * Loads the Functions SDK, or a module that only works with it (a callable client), with the same
 * offline rejection and reload recovery.
 */
export const loadFunctionsModule = async <Module = typeof import('firebase/functions')>(
  importModule: () => Promise<Module> = () =>
    import('firebase/functions') as unknown as Promise<Module>
): Promise<Module> => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw Object.assign(new Error('Sin conexión.'), {
      code: 'functions/unavailable',
    });
  }
  try {
    const sdk = await importModule();
    setReloadRequired(false);
    return sdk;
  } catch (error) {
    if (isChunkLoadError(error)) {
      setReloadRequired(true);
      throw Object.assign(new Error(FUNCTIONS_RELOAD_REQUIRED_MESSAGE), {
        code: 'functions/unavailable',
      });
    }
    throw error;
  }
};
