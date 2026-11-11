import { createCachedRuntimeLoader } from './createCachedRuntimeLoader';
import { setModuleReloadRequired } from './moduleReloadRecovery';
import { isChunkLoadError } from '@/utils/chunkLoadError';

export const createRecoverableRuntimeLoader = <T>(key: string, importModule: () => Promise<T>) =>
  createCachedRuntimeLoader(async () => {
    try {
      const module = await importModule();
      setModuleReloadRequired(key, false);
      return module;
    } catch (error) {
      if (!isChunkLoadError(error) || !navigator.onLine) throw error;
      // navigator.onLine alone does not prove that the application is reachable.
      let connected = false;
      try {
        connected = (
          await fetch(`/version.json?save-recovery=${Date.now()}`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(4000),
          })
        ).ok;
      } catch {
        /* The next online event retries silently. */
      }
      if (!connected) throw error;
      try {
        const module = await importModule();
        setModuleReloadRequired(key, false);
        return module;
      } catch (retryError) {
        if (isChunkLoadError(retryError) && navigator.onLine) setModuleReloadRequired(key, true);
        throw retryError;
      }
    }
  });
