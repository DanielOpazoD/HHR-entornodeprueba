import type { Functions } from 'firebase/functions';
import {
  defaultFirebaseConfigRuntimeAdapter,
  type FirebaseConfigRuntimeAdapter,
} from '@/services/firebase-runtime/firebaseConfigRuntimeAdapter';

export interface FunctionsRuntime {
  ready: Promise<unknown>;
  getFunctions: () => Promise<Functions>;
  getRegionalFunctions: (region: string) => Promise<Functions>;
}

export const createFunctionsRuntime = (
  adapter: FirebaseConfigRuntimeAdapter = defaultFirebaseConfigRuntimeAdapter
): FunctionsRuntime => ({
  ready: adapter.ready,
  getFunctions: () => adapter.getFunctions(),
  getRegionalFunctions: region => adapter.getRegionalFunctions(region),
});

export const defaultFunctionsRuntime: FunctionsRuntime = createFunctionsRuntime();
