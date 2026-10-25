import type { FirebaseApp } from 'firebase/app';
import type { FirebaseStorage } from 'firebase/storage';
import type { Functions } from 'firebase/functions';
import { loadFunctionsModule } from './functionsModuleLoader';
import { parseEmulatorHost } from '@/services/firebase-runtime/firebaseEnvironmentPolicy';
import { firebaseLazyServicesLogger } from '@/services/firebase-runtime/firebaseRuntimeLoggers';

interface FirebaseLazyServicesState {
  storage?: FirebaseStorage;
  functions?: Functions;
  functionsEmulatorConnected: boolean;
  regionalFunctions: Map<string, Functions>;
  regionalFunctionsEmulatorConnected: Set<string>;
}

export const createFirebaseLazyServicesState = (): FirebaseLazyServicesState => ({
  storage: undefined,
  functions: undefined,
  functionsEmulatorConnected: false,
  regionalFunctions: new Map(),
  regionalFunctionsEmulatorConnected: new Set(),
});

export const resolveStorageInstance = async (
  app: FirebaseApp,
  state: FirebaseLazyServicesState
): Promise<FirebaseStorage> => {
  if (state.storage) return state.storage;

  const { getStorage } = await import('firebase/storage');
  state.storage = getStorage(app);
  return state.storage;
};

export const resolveFunctionsInstance = async (
  app: FirebaseApp,
  state: FirebaseLazyServicesState
): Promise<Functions> => {
  const sdk = await loadFunctionsModule();
  if (!state.functions) {
    const { getFunctions } = sdk;
    state.functions = getFunctions(app);
  }

  if (import.meta.env.DEV && !state.functionsEmulatorConnected) {
    const functionsEmulatorHost = import.meta.env.VITE_FUNCTIONS_EMULATOR_HOST;
    if (functionsEmulatorHost) {
      const emulatorHost = parseEmulatorHost(functionsEmulatorHost);
      if (!emulatorHost) {
        firebaseLazyServicesLogger.warn(
          '[FirebaseConfig] Invalid functions emulator host:',
          functionsEmulatorHost
        );
        return state.functions;
      }
      const { connectFunctionsEmulator } = sdk;
      connectFunctionsEmulator(state.functions, emulatorHost.host, emulatorHost.port);
      state.functionsEmulatorConnected = true;
    }
  }

  return state.functions;
};

/**
 * Instancia de Functions fijada a una región distinta de la default. Las
 * callables de autoridad del censo viven junto a Firestore
 * (southamerica-west1) para no pagar un cruce de continente por operación.
 */
export const resolveRegionalFunctionsInstance = async (
  app: FirebaseApp,
  state: FirebaseLazyServicesState,
  region: string
): Promise<Functions> => {
  const sdk = await loadFunctionsModule();
  let instance = state.regionalFunctions.get(region);
  if (!instance) {
    const { getFunctions } = sdk;
    instance = getFunctions(app, region);
    state.regionalFunctions.set(region, instance);
  }

  if (import.meta.env.DEV && !state.regionalFunctionsEmulatorConnected.has(region)) {
    const functionsEmulatorHost = import.meta.env.VITE_FUNCTIONS_EMULATOR_HOST;
    if (functionsEmulatorHost) {
      const emulatorHost = parseEmulatorHost(functionsEmulatorHost);
      if (!emulatorHost) {
        firebaseLazyServicesLogger.warn(
          '[FirebaseConfig] Invalid functions emulator host:',
          functionsEmulatorHost
        );
        return instance;
      }
      const { connectFunctionsEmulator } = sdk;
      connectFunctionsEmulator(instance, emulatorHost.host, emulatorHost.port);
      state.regionalFunctionsEmulatorConnected.add(region);
    }
  }

  return instance;
};
