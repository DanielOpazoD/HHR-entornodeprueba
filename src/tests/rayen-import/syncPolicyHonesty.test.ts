import { describe, expect, it } from 'vitest';
import {
  POLICY_SESSION_EXPIRED_MESSAGE,
  resolveRayenPolicyBlockMessage,
} from '@/features/rayen-import/hooks/useRayenImportMode';
import {
  classifyRayenApplyFailureReason,
  classifyRayenSyncError,
} from '@/features/rayen-import/observability/rayenSyncDiagnostics';
import {
  presentRayenSyncRecovery,
  rayenFailureReasonLabel,
} from '@/features/rayen-import/components/rayenSyncPresentation';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';

/**
 * Honestidad del flujo de sincronización ante una sesión sin permisos.
 *
 * Incidente del 01-09: el servidor estaba sano (cero errores en las functions,
 * ninguna llamada en la ventana de la corrida) pero la sesión había perdido sus
 * permisos. La app culpaba a la conexión, dejaba el botón habilitado para
 * gastar ~9 s de captura condenada, y archivaba la corrida como un genérico
 * «No se pudo aplicar el censo» — diagnosticarlo exigió leer Cloud Functions.
 */
describe('sincronización · honestidad ante sesión sin permisos', () => {
  const permissionDenied = Object.assign(new Error('Missing or insufficient permissions'), {
    code: 'permission-denied',
  });

  describe('estado de la política', () => {
    it('no bloquea mientras está lista o cargando', () => {
      expect(resolveRayenPolicyBlockMessage('ready')).toBeNull();
      // `loading` no deshabilita el botón (evita el parpadeo en cada carga);
      // la compuerta del clic sigue protegiendo.
      expect(resolveRayenPolicyBlockMessage('loading')).toBeNull();
    });

    it('nombra el remedio real cuando la sesión perdió permisos', () => {
      const message = resolveRayenPolicyBlockMessage('unauthorized');
      expect(message).toBe(POLICY_SESSION_EXPIRED_MESSAGE);
      expect(message).toMatch(/vuelve a iniciar sesión/i);
      // El pecado original: mandar a esperar una conexión que nunca fue el problema.
      expect(message).not.toMatch(/conexión/i);
    });

    it('conserva los mensajes propios de los demás estados', () => {
      expect(resolveRayenPolicyBlockMessage('unconfigured')).toMatch(/no está configurada/i);
      expect(resolveRayenPolicyBlockMessage('migration-required')).toMatch(/migración a v2/i);
      expect(resolveRayenPolicyBlockMessage('fallback')).toMatch(/vuelva la conexión/i);
    });
  });

  describe('clasificación del error', () => {
    it('reconoce permission-denied por código y por mensaje', () => {
      expect(classifyRayenSyncError(permissionDenied)).toBe('permission_denied');
      expect(classifyRayenSyncError(new Error('Missing or insufficient permissions'))).toBe(
        'permission_denied'
      );
      expect(classifyRayenSyncError({ code: 'unauthenticated' })).toBe('permission_denied');
    });

    it('traduce la causa a la razón persistida en el historial', () => {
      expect(classifyRayenApplyFailureReason(permissionDenied)).toBe('apply_unauthorized');
      const conflict = Object.assign(new Error('modificado por otro usuario'), {
        name: 'ConcurrencyError',
      });
      expect(classifyRayenApplyFailureReason(conflict)).toBe('apply_conflict');
      // Lo que no sabemos nombrar sigue siendo genérico, no se inventa causa.
      expect(classifyRayenApplyFailureReason(new Error('boom'))).toBe('apply_failed');
    });

    it('distingue las tres causas en el historial en vez de un rótulo único', () => {
      expect(rayenFailureReasonLabel('apply_unauthorized')).toBe(
        'Sesión sin permisos para guardar'
      );
      expect(rayenFailureReasonLabel('apply_conflict')).toBe('El censo cambió durante el guardado');
      expect(rayenFailureReasonLabel('apply_failed')).toBe('No se pudo aplicar el censo');
    });
  });

  describe('banner de recuperación', () => {
    const failedRun = (failureReason: RayenSyncEvent['failureReason']): RayenSyncEvent =>
      ({
        id: 'run-1',
        startedAt: '2026-09-01T13:53:08.549Z',
        completedAt: '2026-09-01T13:53:22.150Z',
        by: 'Daniel Opazo Damiani',
        status: 'failed',
        failureReason,
      }) as RayenSyncEvent;

    it('no ofrece un reintento condenado cuando el fallo fue de permisos', () => {
      const recovery = presentRayenSyncRecovery(failedRun('apply_unauthorized'), 'ready', false);

      expect(recovery).toMatchObject({
        title: 'Sesión sin permisos',
        action: null,
        actionLabel: null,
        tone: 'warning',
      });
      expect(recovery?.detail).toMatch(/vuelve a iniciar sesión/i);
      // Con Eloísa sana el banner decía «Eloísa está operativa» y ofrecía
      // «Revisar censo»: cierto pero irrelevante, y el reintento volvía a fallar.
      expect(recovery?.detail).not.toMatch(/Eloísa está operativa/i);
    });

    it('mantiene el reintento para los fallos que sí pueden resolverse reintentando', () => {
      const recovery = presentRayenSyncRecovery(failedRun('apply_failed'), 'ready', false);
      expect(recovery?.action).toBe('retry_full');
      expect(recovery?.actionLabel).toBe('Revisar censo');
    });
  });
});
