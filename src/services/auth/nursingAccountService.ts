import type { ManagedUserRole } from '@/shared/access/roleAccessMatrix';
import {
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import type { Functions } from 'firebase/functions';
import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { clearRecentAuthRoleLookups } from './authRoleLookup';
import { waitForPendingLogout } from './authLogoutState';
import { captureSessionProfessionalIdentity } from '@/services/user-profile/sessionProfessionalIdentity';
import {
  runSessionStorageTransition,
  SESSION_GENERATION_KEY,
} from '@/services/storage/sessionStorageTransition';

export interface NursingAccount {
  uid: string;
  name: string;
  rut: string;
  role: ManagedUserRole;
  recoveryEmail?: string;
  canEnable?: boolean;
  deletedAt?: number | null;
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

// The SDK reports these when a regional endpoint gave no usable answer (network or CORS-less
// platform failure, timeout) or failed unexpectedly. Credential and rate-limit rejections are final.
const REGIONAL_SIGN_IN_FALLBACK_CODES = new Set([
  'functions/internal',
  'functions/unavailable',
  'functions/deadline-exceeded',
]);

const invokeAccountCallable = async <T>(
  functions: Functions,
  callableName: string,
  data: Record<string, unknown>
): Promise<T> => {
  const { httpsCallable } = await import('firebase/functions');
  const response = await httpsCallable<Record<string, unknown>, T>(functions, callableName, {
    timeout: 60000,
  })(data);
  return response.data;
};

export const callAccount = async <T>(
  name: string,
  data: Record<string, unknown> = {}
): Promise<T> => {
  const requestedRegion = import.meta.env.VITE_ACCOUNT_FUNCTIONS_REGION;
  const defaultRegion =
    import.meta.env.VITE_FIREBASE_PROJECT_ID === 'hhr-pruebas'
      ? 'southamerica-west1'
      : 'us-central1';
  const signInRegion =
    requestedRegion === undefined || requestedRegion === ''
      ? defaultRegion
      : requestedRegion === 'southamerica-east1' || requestedRegion === 'southamerica-west1'
        ? requestedRegion
        : 'us-central1';
  if (name !== 'signInWithRut' || signInRegion === 'us-central1') {
    return invokeAccountCallable<T>(await defaultFunctionsRuntime.getFunctions(), name, data);
  }
  const callableName = signInRegion === 'southamerica-west1' ? 'signInWithRutSantiago' : name;
  try {
    return await invokeAccountCallable<T>(
      await defaultFunctionsRuntime.getRegionalFunctions(signInRegion),
      callableName,
      data
    );
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (typeof code !== 'string' || !REGIONAL_SIGN_IN_FALLBACK_CODES.has(code)) throw error;
    // Sign-in changes no credential, so the US callable can run the same request again; it costs
    // one more rate-limit attempt. The event keeps a regional outage visible behind the fallback.
    try {
      recordOperationalTelemetry({
        category: 'auth',
        operation: 'rut_sign_in_region_fallback',
        status: 'degraded',
        runtimeState: 'recoverable',
        context: {
          region: signInRegion,
          errorCode: code,
          isOnline: typeof window !== 'undefined' ? window.navigator.onLine : null,
        },
        issues: [`Ingreso por RUT: ${signInRegion} no disponible (${code}); se reintentó en US.`],
      });
    } catch {
      // Telemetry must never cost the user the fallback sign-in.
    }
    return invokeAccountCallable<T>(await defaultFunctionsRuntime.getFunctions(), name, data);
  }
};

export interface InitialAccountSetup {
  requiresSetup: true;
  activationToken: string;
}

export const establishNursingSession = async (
  action:
    | 'signInWithRut'
    | 'activateNursingAccount'
    | 'changeNursingPassword'
    | 'resetNursingPassword',
  data: Record<string, unknown>,
  isCurrent: () => boolean = () => true
): Promise<void | InitialAccountSetup> => {
  await defaultAuthRuntime.ready;
  // A logout still under way would leave this sign-in with its user, generation and token.
  await waitForPendingLogout();
  const auth = defaultAuthRuntime.auth;
  const initialUser = auth.currentUser;
  const generation = localStorage.getItem(SESSION_GENERATION_KEY);
  const response = await callAccount<{ credentialEmail: string } | InitialAccountSetup>(action, {
    ...data,
    apiKey: auth.app.options.apiKey,
  });
  if ('requiresSetup' in response) {
    if (
      !isCurrent() ||
      auth.currentUser !== initialUser ||
      localStorage.getItem(SESSION_GENERATION_KEY) !== generation
    ) {
      throw new Error('La sesión cambió; vuelve a iniciar sesión.');
    }
    return response;
  }
  await runSessionStorageTransition(async () => {
    if (
      !isCurrent() ||
      auth.currentUser !== initialUser ||
      localStorage.getItem(SESSION_GENERATION_KEY) !== generation
    ) {
      throw new Error('La sesión cambió; vuelve a iniciar sesión.');
    }
    clearRecentAuthRoleLookups();
    await setPersistence(auth, browserSessionPersistence);
    const result = await signInWithEmailAndPassword(
      auth,
      response.credentialEmail,
      String(data.password)
    );
    if (auth.currentUser === result.user && isCurrent()) {
      captureSessionProfessionalIdentity({
        uid: result.user.uid,
        name: result.user.displayName ?? '',
        rut: data.rut,
      });
    }
  });
};

export const accountErrorMessage = (error: unknown): string => {
  if (!navigator.onLine) return 'Sin conexión.';
  const code = (error as { code?: string })?.code;
  if (code === 'functions/unavailable')
    return 'La recuperación por correo no está disponible ahora. Contacta al administrador.';
  if (code === 'functions/invalid-argument')
    return 'Revisa el correo y la clave: mínimo 6 caracteres, una mayúscula y un número.';
  if (code === 'functions/resource-exhausted') return 'Demasiados intentos. Espera unos minutos.';
  if (code === 'functions/failed-precondition')
    return 'Vuelve a ingresar para administrar accesos.';
  if (code === 'functions/already-exists')
    return 'El RUT ya tiene una cuenta. Revisa su estado en la lista.';
  return 'No se pudo validar el acceso o el código. Revisa los datos o solicita un nuevo código.';
};
