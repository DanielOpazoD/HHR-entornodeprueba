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

export async function registerNursingHandoffDevice(deviceId: string, challenge: string) {
  const functions = await defaultFunctionsRuntime.getRegionalFunctions('southamerica-east1');
  const register = httpsCallable<{ deviceId: string; challenge: string }, { registered: boolean }>(
    functions,
    'registerNursingHandoffDevice',
    { timeout: 15000 }
  );
  const { data } = await register({ deviceId, challenge });
  if (data.registered !== true) throw new Error('HHR no confirmó el registro');
}
