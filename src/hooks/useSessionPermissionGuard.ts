import { useEffect } from 'react';
import type { AuthSessionState } from '@/types/authSessionTypes';
import type { AuthUser } from '@/types/authRoleTypes';
import { createUnauthorizedAuthSessionState } from '@/services/auth/authSessionState';
import {
  resetSessionPermissionStormDetector,
  subscribeToSessionPermissionStorm,
} from '@/services/auth/sessionPermissionStormDetector';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { authStateLogger } from '@/hooks/hookLoggers';

/**
 * Mensaje único del caso «sesión sin permisos». Lo muestra la pantalla de
 * acceso (App.tsx lo toma de sessionState.reason) para que el usuario sepa
 * POR QUÉ volvió al login, en vez de encontrarse el censo vacío y 17 errores
 * independientes en consola.
 */
export const SESSION_PERMISSIONS_LOST_MESSAGE =
  'Tu sesión perdió los permisos para leer los datos del hospital (normalmente porque expiró). Vuelve a iniciar sesión.';

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
  setSessionState: (state: AuthSessionState) => void
): void => {
  // Se re-arma solo cuando cambia la PERSONA (uid), no la identidad del objeto
  // de sesión: re-armar en cada transición de estado borraría la ventana de
  // denegaciones justo mientras la tormenta ocurre.
  const uid = user?.uid ?? null;
  useEffect(() => {
    if (!uid) return undefined;
    // Cada inicio de sesión empieza sin historial de denegaciones.
    resetSessionPermissionStormDetector();
    let handled = false;
    const unsubscribe = subscribeToSessionPermissionStorm(storm => {
      if (handled) return;
      handled = true;
      authStateLogger.warn('Logout due to a permission-denied storm on basic reads', storm);
      recordOperationalTelemetry({
        category: 'auth',
        operation: 'session_permission_storm_logout',
        status: 'degraded',
        runtimeState: 'unauthorized',
        issues: [SESSION_PERMISSIONS_LOST_MESSAGE],
        context: { sources: storm.sources, detectedAt: storm.detectedAt },
      });
      void handleLogout('automatic').finally(() => {
        // Después de la limpieza: reemplaza el «unauthenticated» genérico del
        // logout por la razón concreta, que es lo que la pantalla de acceso muestra.
        setSessionState(createUnauthorizedAuthSessionState(SESSION_PERMISSIONS_LOST_MESSAGE));
      });
    });
    return unsubscribe;
  }, [uid, handleLogout, setSessionState]);
};
