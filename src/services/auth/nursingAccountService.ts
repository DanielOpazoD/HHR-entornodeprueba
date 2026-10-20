import {
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { clearRecentAuthRoleLookups } from './authRoleLookup';
import {
  runSessionStorageTransition,
  SESSION_GENERATION_KEY,
} from '@/services/storage/sessionStorageTransition';

export interface NursingAccount {
  uid: string;
  name: string;
  rut: string;
  role: 'nurse_hospital';
  status: 'provisioning' | 'pending' | 'setting_password' | 'active' | 'suspended' | 'retired';
  createdAt: number;
  updatedAt: number;
  recoveryRequired: boolean;
}
export interface PrivateActivation {
  activationToken: string;
  expiresAt: number;
}
export interface NursingAccountList {
  accounts: NursingAccount[];
  individualOnly: boolean;
  recentAudit: { id: string; actorUid: string; targetUid: string; action: string; at: number }[];
}

export const callAccount = async <T>(
  name: string,
  data: Record<string, unknown> = {}
): Promise<T> => {
  const functions = await defaultFunctionsRuntime.getFunctions();
  const response = await httpsCallable<Record<string, unknown>, T>(functions, name, {
    timeout: 60000,
  })(data);
  return response.data;
};

export const establishNursingSession = async (
  action: 'signInWithRut' | 'activateNursingAccount' | 'changeNursingPassword',
  data: Record<string, unknown>,
  isCurrent: () => boolean = () => true
): Promise<void> => {
  await defaultAuthRuntime.ready;
  const auth = defaultAuthRuntime.auth;
  const initialUser = auth.currentUser;
  const generation = localStorage.getItem(SESSION_GENERATION_KEY);
  const response = await callAccount<{ credentialEmail: string }>(action, {
    ...data,
    apiKey: auth.app.options.apiKey,
  });
  clearRecentAuthRoleLookups();
  await runSessionStorageTransition(async () => {
    if (
      !isCurrent() ||
      auth.currentUser !== initialUser ||
      localStorage.getItem(SESSION_GENERATION_KEY) !== generation
    ) {
      throw new Error('La sesión cambió; vuelve a iniciar sesión.');
    }
    await setPersistence(auth, browserSessionPersistence);
    await signInWithEmailAndPassword(auth, response.credentialEmail, String(data.password));
  });
};

export const accountErrorMessage = (error: unknown): string => {
  const code = (error as { code?: string })?.code;
  if (code === 'functions/resource-exhausted') return 'Demasiados intentos. Espera unos minutos.';
  if (code === 'functions/failed-precondition')
    return 'Vuelve a ingresar para administrar accesos.';
  if (code === 'functions/already-exists')
    return 'El RUT ya tiene una cuenta. Revisa su estado en la lista.';
  return 'No se pudo completar el acceso. Revisa los datos o solicita una nueva activación.';
};
