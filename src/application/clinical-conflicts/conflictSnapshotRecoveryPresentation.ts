import type { ConflictSnapshotRecoveryEvidence } from '@/application/ports/dailyRecordConflictRecoveryPort';

export type ConflictSnapshotRecoveryStateKind =
  | 'recoverable'
  | 'not_saved'
  | 'expired_ttl'
  | 'permission_denied'
  | 'query_unavailable'
  | 'saved_but_unavailable'
  | 'unknown_empty';

export interface ConflictSnapshotRecoveryState {
  kind: ConflictSnapshotRecoveryStateKind;
  title: string;
  message: string;
}

export const resolveConflictSnapshotRecoveryState = ({
  date,
  snapshotCount,
  snapshotRecovery,
  now,
}: {
  date?: string;
  snapshotCount: number;
  snapshotRecovery?: ConflictSnapshotRecoveryEvidence | null;
  now?: Date;
}): ConflictSnapshotRecoveryState => {
  const day = date || 'este día';
  if (snapshotCount > 0) {
    return {
      kind: 'recoverable',
      title: 'Snapshots recuperables',
      message: `${snapshotCount} versiones en conflicto siguen disponibles para ${day}.`,
    };
  }

  if (snapshotRecovery?.status === 'failed' && snapshotRecovery.unavailableReason) {
    if (snapshotRecovery.unavailableReason === 'permission_denied') {
      return {
        kind: 'permission_denied',
        title: 'Sin permiso para consultar snapshots',
        message:
          `No fue posible consultar las versiones en conflicto para ${day}. ` +
          'Reintenta con rol admin o Hospitalizados HHR vigente. ' +
          'Si el rol ya es correcto, sincroniza claims o despliega las reglas Firestore vigentes.',
      };
    }

    if (snapshotRecovery.unavailableReason === 'query_index_missing') {
      return {
        kind: 'query_unavailable',
        title: 'Consulta de snapshots no disponible',
        message:
          `No fue posible consultar las versiones en conflicto para ${day} porque falta un índice/consulta de Firestore. ` +
          'El centro queda abierto para que el problema sea visible y accionable.',
      };
    }

    return {
      kind: 'query_unavailable',
      title: 'No se pudieron consultar snapshots',
      message:
        `No fue posible consultar las versiones en conflicto para ${day}. ` +
        'Revisa conectividad, permisos o el estado de Firestore.',
    };
  }

  if (snapshotRecovery?.status === 'failed') {
    return {
      kind: 'not_saved',
      title: 'Snapshots no guardados',
      message:
        `Observabilidad registró un conflicto automático para ${day}, ` +
        'pero los snapshots de recuperación no pudieron guardarse.',
    };
  }

  if (snapshotRecovery?.status === 'saved' && (snapshotRecovery.snapshotIds?.length || 0) > 0) {
    const nowMs = now?.getTime() ?? Date.now();
    const expiresAtMs = snapshotRecovery.expiresAt
      ? new Date(snapshotRecovery.expiresAt).getTime()
      : NaN;
    if (
      snapshotRecovery.unavailableReason === 'expired_ttl' ||
      (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs)
    ) {
      return {
        kind: 'expired_ttl',
        title: 'Snapshots expirados por TTL',
        message:
          `Observabilidad registró snapshots de conflicto para ${day}, ` +
          'pero la ventana recuperable expiró por TTL. La auditoría permanente sigue disponible.',
      };
    }

    if (snapshotRecovery.unavailableReason === 'permission_denied') {
      return {
        kind: 'permission_denied',
        title: 'Snapshots sin permiso de lectura',
        message:
          `Observabilidad registró snapshots de conflicto para ${day}, ` +
          'pero el usuario actual no tiene permisos para leerlos. ' +
          'Reintenta con rol admin o Hospitalizados HHR vigente; si el rol ya es correcto, sincroniza claims o despliega las reglas Firestore vigentes.',
      };
    }

    if (snapshotRecovery.unavailableReason === 'query_index_missing') {
      return {
        kind: 'query_unavailable',
        title: 'Consulta de snapshots no disponible',
        message:
          `Observabilidad registró snapshots de conflicto para ${day}, ` +
          'pero falta un índice/consulta de Firestore para recuperarlos. ' +
          'El centro queda abierto para que el problema sea visible y accionable.',
      };
    }

    return {
      kind: 'saved_but_unavailable',
      title: 'Snapshots no disponibles',
      message:
        `Observabilidad registró snapshots de conflicto para ${day}, ` +
        'pero ya expiraron, fueron purgados por TTL o no están disponibles para el usuario actual.',
    };
  }

  return {
    kind: 'unknown_empty',
    title: 'Sin snapshots recuperables',
    message:
      `Para ${day} no hay snapshots recuperables de versiones en conflicto. ` +
      'Si observabilidad registró un conflicto automático, los snapshots pudieron no guardarse, ' +
      'haber expirado o no estar disponibles para el usuario actual.',
  };
};
