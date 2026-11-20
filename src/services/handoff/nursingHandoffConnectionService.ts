import { httpsCallable } from 'firebase/functions';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';

export async function connectNursingHandoff(deviceId: string, challenge: string) {
  const functions = await defaultFunctionsRuntime.getRegionalFunctions('southamerica-east1');
  const call = httpsCallable<Record<string, string>, { expiresAt: number }>(
    functions,
    'nursingHandoffHosted',
    { timeout: 15000 }
  );
  const { data } = await call({ action: 'connect', deviceId, challenge });
  return data.expiresAt;
}
