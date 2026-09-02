import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { AuthSessionState } from '@/types/authSessionTypes';
import type { AuthUser } from '@/types/authRoleTypes';
import { createUnauthorizedAuthSessionState } from '@/services/auth/authSessionState';
import {
  armSessionPermissionStormDetector,
  subscribeToSessionPermissionStorm,
  type SessionPermissionStorm,
} from '@/services/auth/sessionPermissionStormDetector';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { authStateLogger } from '@/hooks/hookLoggers';
import { SESSION_PERMISSION_STORM_CAUSE } from '@/hooks/controllers/authBootstrapController';

/**
 * Mensaje único del caso «sesión sin permisos». Lo muestra la pantalla de
 * acceso (App.tsx lo toma de sessionState.reason) para que el usuario sepa
 * POR QUÉ volvió al login, en vez de encontrarse el censo vacío y 17 errores
 * independientes en consola.
 */
export const SESSION_PERMISSIONS_LOST_MESSAGE =
  'Tu sesión perdió los permisos para leer los datos del hospital (normalmente porque expiró). Vuelve a iniciar sesión.';

export const createSessionPermissionsLostState = (): AuthSessionState =>
  createUnauthorizedAuthSessionState(SESSION_PERMISSIONS_LOST_MESSAGE, {
    cause: SESSION_PERMISSION_STORM_CAUSE,
  });

// Varias instancias de useAuthState se suscriben a la misma tormenta: el efecto
// con consecuencias (logout, auditoría, aviso a otras pestañas) corre UNA vez.
let lastHandledStormAt: number | null = null;

/** Solo para tests. */
export const resetSessionPermissionGuardForTests = (): void => {
  lastHandledStormAt = null;
};

/**
 * Guarda global de sesión: cuando el detector anuncia una tormenta de permisos
 * con un usuario autenticado, cierra la sesión por la MISMA ruta que el logout
 * por inactividad (limpieza local, aviso a otras pestañas, signOut) y deja la
 * razón visible en la pantalla de acceso. No intenta «sanar» la sesión: los
 * listeners de Firestore ya denegados quedan muertos aunque el token se
 * refresque, así que lo honesto es cortar y explicar.
 */
export const useSessionPermissionGuard = (
  user: AuthUser | null,
  handleLogout: (reason?: 'manual' | 'automatic') => Promise<void>,
  setSessionState: Dispatch<SetStateAction<AuthSessionState>>
): void => {
  const uid = user?.uid ?? null;
  useEffect(() => {
    if (!uid) return undefined;
    armSessionPermissionStormDetector(uid);
    const unsubscribe = subscribeToSessionPermissionStorm((storm: SessionPermissionStorm) => {
      const isFirstHandler = lastHandledStormAt !== storm.detectedAt;
      lastHandledStormAt = storm.detectedAt;
      if (isFirstHandler) {
        authStateLogger.warn('Logout due to a permission-denied storm on basic reads', storm);
        recordOperationalTelemetry({
          category: 'auth',
          operation: 'session_permission_storm_logout',
          status: 'degraded',
          runtimeState: 'unauthorized',
          issues: [SESSION_PERMISSIONS_LOST_MESSAGE],
          context: { sources: storm.sources, detectedAt: storm.detectedAt },
        });
        // handleLogout fija 'unauthenticated' de forma SÍNCRONA antes de su
        // primer await; no se espera su promesa: la auditoría del logout puede
        // quedar pendiente hasta un re-login y un setter tardío pisaría una
        // sesión nueva (revisión adversarial 01-09).
        void handleLogout('automatic');
      }
      // Cada instancia deja la razón en SU estado, solo sobre la sesión que se
      // está cerrando (la autorizada o el 'unauthenticated' que acaba de dejar
      // el logout). La política de preservación evita que el listener de
      // Firebase la pise después.
      setSessionState(current =>
        current.status === 'unauthenticated' || current.status === 'authorized'
          ? createSessionPermissionsLostState()
          : current
      );
    });
    return unsubscribe;
  }, [uid, handleLogout, setSessionState]);
};
