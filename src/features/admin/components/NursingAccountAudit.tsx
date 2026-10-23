import React from 'react';
import type { NursingAccount, NursingAccountList } from '@/services/auth/nursingAccountService';
import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';

const actions: Record<string, string> = {
  account_created: 'Cuenta creada',
  invitation_issued: 'Activación emitida',
  password_recovery_requested: 'Código de recuperación solicitado',
  password_recovery_delivery_failed: 'No se pudo enviar el código de recuperación',
  password_recovery_consumed: 'Recuperación de contraseña confirmada',
  password_established: 'Clave establecida',
  password_operation_revoked: 'Cambio de clave revocado',
  suspend: 'Usuario deshabilitado',
  reset: 'Clave inicial restablecida',
  repair_reset: 'Acceso interrumpido recuperado con clave inicial',
  update: 'Nombre o rol modificado',
  enable: 'Usuario habilitado',
  delete: 'Usuario eliminado; autorías conservadas',
  revoke: 'Sesiones revocadas',
  retire: 'Acceso retirado',
  individual_access_enabled: 'Accesos antiguos retirados',
};
export default function NursingAccountAudit({
  events,
  accounts,
}: {
  events: NursingAccountList['recentAudit'];
  accounts: NursingAccount[];
}) {
  const label = (uid: string) =>
    uid === 'unauthenticated-recovery'
      ? 'Solicitud sin sesión'
      : accounts.find(account => account.uid === uid)?.name || uid;
  return (
    <details className="rounded border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Actividad reciente de accesos</summary>
      <p className="my-2 text-slate-500">
        Últimas 20 operaciones. Sin claves ni códigos de activación.
      </p>
      <ul>
        {events.map(event => (
          <li key={event.id} className="border-t py-2">
            {new Date(event.at).toLocaleString('es-CL', { timeZone: CLINICAL_TIME_ZONE })} ·{' '}
            {actions[event.action] || event.action} · {label(event.targetUid)} · responsable:{' '}
            {label(event.actorUid)}
          </li>
        ))}
      </ul>
    </details>
  );
}
