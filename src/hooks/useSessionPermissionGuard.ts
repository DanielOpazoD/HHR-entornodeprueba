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

// Varias instancias de useAuthState se suscriben a la misma tormenta: la
// comprobación, la telemetría y el logout corren UNA vez por tormenta.
let verdictForStorm: {
  detectedAt: number;
  verdict: Promise<'recovering' | 'logout'>;
} | null = null;

/** Solo para tests. */
export const resetSessionPermissionGuardForTests = (): void => {
  verdictForStorm = null;
};

/** La segunda opinión vive en un módulo diferido: una tormenta es rara y el arranque no tiene espacio. */
const decideStorm = (storm: SessionPermissionStorm): Promise<'recovering' | 'logout'> => {
  if (verdictForStorm?.detectedAt === storm.detectedAt) return verdictForStorm.verdict;
  const verdict = import('@/services/auth/sessionPermissionStormVerdict')
    .then(module => module.decideSessionPermissionStorm(storm, SESSION_PERMISSIONS_LOST_MESSAGE))
    .catch(() => {
      // Sin el módulo (p. ej. una publicación nueva sin conexión) se cierra como siempre.
      recordOperationalTelemetry({
        category: 'auth',
        operation: 'session_permission_storm_logout',
        status: 'degraded',
        runtimeState: 'unauthorized',
        issues: [SESSION_PERMISSIONS_LOST_MESSAGE],
        context: { sources: storm.sources, detectedAt: storm.detectedAt },
      });
      return 'logout' as const;
    });
  verdictForStorm = { detectedAt: storm.detectedAt, verdict };
  return verdict;
};

/**
 * Guarda global de sesión: cuando el detector anuncia una tormenta de permisos con un usuario
 * autenticado, primero comprueba si la sesión realmente perdió los permisos. Si la lectura de
 * prueba funciona, recupera en silencio con una recarga. Si no, cierra la sesión por la MISMA
 * ruta que el logout por inactividad (limpieza local, aviso a otras pestañas, signOut) y deja la
 * razón visible en la pantalla de acceso. Los listeners ya denegados no reviven al refrescar el
 * token: por eso la recuperación es una recarga y no un «seguir como si nada».
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
    let active = true;
    const unsubscribe = subscribeToSessionPermissionStorm((storm: SessionPermissionStorm) => {
      const isFirstHandler = verdictForStorm?.detectedAt !== storm.detectedAt;
      void decideStorm(storm).then(verdict => {
        if (verdict !== 'logout' || !active) return;
        // handleLogout fija 'unauthenticated' de forma SÍNCRONA antes de su
        // primer await; no se espera su promesa: la auditoría del logout puede
        // quedar pendiente hasta un re-login y un setter tardío pisaría una
        // sesión nueva (revisión adversarial 01-09).
        if (isFirstHandler) void handleLogout('automatic');
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
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [uid, handleLogout, setSessionState]);
};
