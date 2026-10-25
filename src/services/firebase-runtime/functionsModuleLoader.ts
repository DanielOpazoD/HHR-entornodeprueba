import { isChunkLoadError } from '@/utils/chunkLoadError';

let reloadRequired = false;
const listeners = new Set<() => void>();

export const isFunctionsReloadRequired = () => reloadRequired;
export const subscribeFunctionsRecovery = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const setReloadRequired = (value: boolean) => {
  if (reloadRequired === value) return;
  reloadRequired = value;
  listeners.forEach(listener => listener());
};

export const loadFunctionsModule = async (
  importModule: () => Promise<typeof import('firebase/functions')> = () =>
    import('firebase/functions')
) => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw Object.assign(new Error('Functions unavailable while offline.'), {
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
      throw Object.assign(new Error('Functions module requires recovery.'), {
        code: 'functions/unavailable',
      });
    }
    throw error;
  }
};
