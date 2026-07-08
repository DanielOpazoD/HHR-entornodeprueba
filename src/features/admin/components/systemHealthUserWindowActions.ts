import type {
  SystemHealthIncidentResolutionActor,
  SystemHealthIncidentResolutionState,
  UserHealthStatus,
} from '@/services/admin/healthService';
import type { SystemHealthIncidentRow } from './systemHealthIncidentTypes';
import { buildResolvedIncidentResolution } from './systemHealthResolutionState';

export const SYSTEM_HEALTH_CLEAR_USER_NOTE =
  'Borrón y cuenta nueva para el usuario desde Salud de usuarios';

interface ConfirmDialogRequest {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  variant: 'danger';
}

interface RunClearSystemHealthUserWindowActionOptions {
  user: UserHealthStatus;
  incidents: SystemHealthIncidentRow[];
  actor: SystemHealthIncidentResolutionActor;
  confirm: (request: ConfirmDialogRequest) => Promise<boolean>;
  resolveIncident: (params: {
    resolutionKey: string;
    resolvedAt: string;
    actor: SystemHealthIncidentResolutionActor;
    note: string;
  }) => Promise<void>;
  deleteSnapshot: (uid: string) => Promise<void>;
  setDeletingUid: (uid: string | null) => void;
  setResolutionState: (
    updater: (current: SystemHealthIncidentResolutionState) => SystemHealthIncidentResolutionState
  ) => void;
  onClearSelection: () => void;
  onSuccess: (user: UserHealthStatus) => void;
  onError: (error: unknown) => void;
}

interface RunResolveVisibleSystemHealthIncidentsActionOptions {
  incidents: SystemHealthIncidentRow[];
  actor: SystemHealthIncidentResolutionActor;
  resolveIncident: RunClearSystemHealthUserWindowActionOptions['resolveIncident'];
  setResolutionState: RunClearSystemHealthUserWindowActionOptions['setResolutionState'];
  onSuccess: (count: number) => void;
  onError: (error: unknown) => void;
}

const buildClearUserResolutionState = ({
  current,
  incidents,
  resolvedAt,
  actor,
}: {
  current: SystemHealthIncidentResolutionState;
  incidents: SystemHealthIncidentRow[];
  resolvedAt: string;
  actor: SystemHealthIncidentResolutionActor;
}): SystemHealthIncidentResolutionState => {
  const next = { ...current };
  incidents.forEach(incident => {
    next[incident.resolutionKey] = buildResolvedIncidentResolution({
      resolutionKey: incident.resolutionKey,
      previous: current,
      resolvedAt,
      actor,
      note: SYSTEM_HEALTH_CLEAR_USER_NOTE,
    });
  });
  return next;
};

export const runClearSystemHealthUserWindowAction = async ({
  user,
  incidents,
  actor,
  confirm,
  resolveIncident,
  deleteSnapshot,
  setDeletingUid,
  setResolutionState,
  onClearSelection,
  onSuccess,
  onError,
}: RunClearSystemHealthUserWindowActionOptions): Promise<void> => {
  const openIncidents = incidents.filter(incident => incident.status !== 'resolved');
  const confirmed = await confirm({
    title: 'Limpiar usuario desde ahora',
    message: `Se marcaran como resueltos los incidentes visibles de ${user.displayName} y se borrara su snapshot actual. Si vuelve a fallar, Salud registrara eventos nuevos desde el proximo ciclo.`,
    confirmText: 'Limpiar usuario',
    cancelText: 'Cancelar',
    variant: 'danger',
  });

  if (!confirmed) return;

  const resolvedAt = new Date().toISOString();
  let previousResolutionState: SystemHealthIncidentResolutionState | null = null;
  setDeletingUid(user.uid);
  setResolutionState(current => {
    previousResolutionState = current;
    return buildClearUserResolutionState({
      current,
      incidents: openIncidents,
      resolvedAt,
      actor,
    });
  });

  try {
    await Promise.all(
      openIncidents.map(incident =>
        resolveIncident({
          resolutionKey: incident.resolutionKey,
          resolvedAt,
          actor,
          note: SYSTEM_HEALTH_CLEAR_USER_NOTE,
        })
      )
    );
    await deleteSnapshot(user.uid);
    onSuccess(user);
    onClearSelection();
  } catch (clearError) {
    const rollbackState = previousResolutionState;
    if (rollbackState) {
      setResolutionState(() => rollbackState);
    }
    onError(clearError);
  } finally {
    setDeletingUid(null);
  }
};

export const runResolveVisibleSystemHealthIncidentsAction = async ({
  incidents,
  actor,
  resolveIncident,
  setResolutionState,
  onSuccess,
  onError,
}: RunResolveVisibleSystemHealthIncidentsActionOptions): Promise<void> => {
  const openIncidents = incidents.filter(incident => incident.status !== 'resolved');
  if (openIncidents.length === 0) return;

  const note = 'Cierre operacional masivo desde Salud de usuarios';
  const resolvedAt = new Date().toISOString();
  let previousResolutionState: SystemHealthIncidentResolutionState | null = null;
  setResolutionState(current => {
    previousResolutionState = current;
    const next = { ...current };
    openIncidents.forEach(incident => {
      next[incident.resolutionKey] = buildResolvedIncidentResolution({
        resolutionKey: incident.resolutionKey,
        previous: current,
        resolvedAt,
        actor,
        note,
      });
    });
    return next;
  });

  try {
    await Promise.all(
      openIncidents.map(incident =>
        resolveIncident({
          resolutionKey: incident.resolutionKey,
          resolvedAt,
          actor,
          note,
        })
      )
    );
    onSuccess(openIncidents.length);
  } catch (resolveError) {
    const rollbackState = previousResolutionState;
    if (rollbackState) {
      setResolutionState(() => rollbackState);
    }
    onError(resolveError);
  }
};
