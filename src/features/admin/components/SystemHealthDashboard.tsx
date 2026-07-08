import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Users } from 'lucide-react';
import {
  deleteUserHealthSnapshot,
  reopenSystemHealthIncident,
  resolveSystemHealthIncident,
  subscribeToSystemHealth,
  subscribeToSystemHealthIncidentResolutions,
  type SystemHealthIncidentResolutionState,
  type UserHealthStatus,
} from '@/services/admin/healthService';
import { useAuth } from '@/context/AuthContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { SystemHealthIncidentDetailPanel } from './SystemHealthIncidentDetailPanel';
import { SystemHealthIncidentQueue } from './SystemHealthIncidentQueue';
import { SystemHealthSyncConvergencePanel } from './SystemHealthSyncConvergencePanel';
import { SystemHealthTriageToolbar } from './SystemHealthTriageToolbar';
import { buildSystemHealthSyncConvergencePanelModel } from './systemHealthSyncConvergenceModel';
import {
  buildSystemHealthTriageModel,
  exportSystemHealthIncidentsCsv,
  shiftSystemHealthSelectedDate,
  type SystemHealthDateRange,
  type SystemHealthEventTypeFilter,
  type SystemHealthIncidentRow,
  type SystemHealthSeverityFilter,
} from './systemHealthIncidentUtils';
import {
  buildReopenedIncidentResolution,
  buildResolvedIncidentResolution,
} from './systemHealthResolutionState';
import {
  runClearSystemHealthUserWindowAction,
  runResolveVisibleSystemHealthIncidentsAction,
} from './systemHealthUserWindowActions';

const todayInputValue = () => new Date().toISOString().slice(0, 10);

export const SystemHealthDashboard = () => {
  const { currentUser, role } = useAuth();
  const { confirm } = useConfirmDialog();
  const { success, error } = useNotification();
  const [stats, setStats] = useState<UserHealthStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState<SystemHealthDateRange>('last24h');
  const [selectedDate, setSelectedDate] = useState(todayInputValue);
  const [severity, setSeverity] = useState<SystemHealthSeverityFilter>('all');
  const [eventType, setEventType] = useState<SystemHealthEventTypeFilter>('all');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [selectedResolutionKey, setSelectedResolutionKey] = useState<string | null>(null);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const [resolutionState, setResolutionState] = useState<SystemHealthIncidentResolutionState>({});

  useEffect(() => {
    const unsubscribe = subscribeToSystemHealth(data => {
      setStats(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToSystemHealthIncidentResolutions(setResolutionState);
    return () => unsubscribe();
  }, []);

  const triageModel = useMemo(
    () =>
      buildSystemHealthTriageModel(stats, {
        selectedUid,
        resolutionState,
        filters: {
          searchTerm,
          dateRange,
          selectedDate,
          severity,
          eventType,
        },
      }),
    [dateRange, eventType, resolutionState, searchTerm, selectedDate, selectedUid, severity, stats]
  );
  const { filteredUsers, selectedUser, selectedIncidents, incidentQueue } = triageModel;
  const syncConvergenceModel = useMemo(
    () => buildSystemHealthSyncConvergencePanelModel(filteredUsers),
    [filteredUsers]
  );
  const canManageSystemHealthOperations = role === 'admin';

  const notifyAdminOnlyAction = () => {
    error('Accion restringida', 'Requiere rol admin');
  };

  const orderedSelectedIncidents = useMemo(() => {
    if (!selectedResolutionKey) return selectedIncidents;
    return [...selectedIncidents].sort((a, b) => {
      if (a.resolutionKey === selectedResolutionKey) return -1;
      if (b.resolutionKey === selectedResolutionKey) return 1;
      return 0;
    });
  }, [selectedIncidents, selectedResolutionKey]);

  useEffect(() => {
    if (!selectedUid && filteredUsers[0]) {
      setSelectedUid(filteredUsers[0].uid);
      return;
    }
    if (selectedUid && !filteredUsers.some(user => user.uid === selectedUid)) {
      setSelectedUid(filteredUsers[0]?.uid || null);
      setSelectedResolutionKey(null);
    }
  }, [filteredUsers, selectedUid]);

  useEffect(() => {
    if (!selectedResolutionKey && incidentQueue[0]) {
      setSelectedResolutionKey(incidentQueue[0].resolutionKey);
      setSelectedUid(incidentQueue[0].userUid);
      return;
    }
    if (
      selectedResolutionKey &&
      !incidentQueue.some(incident => incident.resolutionKey === selectedResolutionKey)
    ) {
      setSelectedResolutionKey(incidentQueue[0]?.resolutionKey || null);
      setSelectedUid(incidentQueue[0]?.userUid || filteredUsers[0]?.uid || null);
    }
  }, [filteredUsers, incidentQueue, selectedResolutionKey]);

  const handleDeleteSnapshot = async (user: UserHealthStatus) => {
    if (!canManageSystemHealthOperations) {
      notifyAdminOnlyAction();
      return;
    }

    const confirmed = await confirm({
      title: 'Borrar registro de salud',
      message: `Se eliminara el snapshot operativo de ${user.displayName}. Si el usuario sigue activo, volvera a reportar en el proximo ciclo.`,
      confirmText: 'Borrar',
      cancelText: 'Cancelar',
      variant: 'danger',
    });

    if (!confirmed) return;

    setDeletingUid(user.uid);
    try {
      await deleteUserHealthSnapshot(user.uid);
      success('Registro de salud borrado', user.email);
      if (selectedUid === user.uid) {
        setSelectedUid(null);
        setSelectedResolutionKey(null);
      }
    } catch (deleteError) {
      error('No se pudo borrar el registro de salud', String(deleteError));
    } finally {
      setDeletingUid(null);
    }
  };

  const handleClearUserWindow = async (
    user: UserHealthStatus,
    incidents: SystemHealthIncidentRow[]
  ) => {
    if (!canManageSystemHealthOperations) {
      notifyAdminOnlyAction();
      return;
    }

    await runClearSystemHealthUserWindowAction({
      user,
      incidents,
      actor: buildResolutionActor(),
      confirm,
      resolveIncident: resolveSystemHealthIncident,
      deleteSnapshot: deleteUserHealthSnapshot,
      setDeletingUid,
      setResolutionState,
      onClearSelection: () => {
        if (selectedUid === user.uid) {
          setSelectedUid(null);
          setSelectedResolutionKey(null);
        }
      },
      onSuccess: clearedUser => success('Usuario limpiado desde ahora', clearedUser.email),
      onError: clearError => error('No se pudo limpiar el usuario', String(clearError)),
    });
  };

  const buildResolutionActor = () => ({
    uid: currentUser?.uid,
    email: currentUser?.email,
    displayName: currentUser?.displayName,
  });

  const handleResolveIncident = async (resolutionKey: string, note?: string) => {
    if (!canManageSystemHealthOperations) {
      notifyAdminOnlyAction();
      return;
    }

    const resolvedAt = new Date().toISOString();
    const actor = buildResolutionActor();
    let previousResolutionState: SystemHealthIncidentResolutionState | null = null;
    setResolutionState(current => {
      previousResolutionState = current;
      return {
        ...current,
        [resolutionKey]: buildResolvedIncidentResolution({
          resolutionKey,
          previous: current,
          resolvedAt,
          actor,
          note,
        }),
      };
    });

    try {
      await resolveSystemHealthIncident({
        resolutionKey,
        resolvedAt,
        actor,
        note,
      });
      success('Incidente marcado como resuelto', resolutionKey);
    } catch (resolveError) {
      if (previousResolutionState) {
        setResolutionState(previousResolutionState);
      }
      error('No se pudo resolver el incidente', String(resolveError));
    }
  };

  const handleReopenIncident = async (resolutionKey: string) => {
    if (!canManageSystemHealthOperations) {
      notifyAdminOnlyAction();
      return;
    }

    const reopenedAt = new Date().toISOString();
    const actor = buildResolutionActor();
    let previousResolutionState: SystemHealthIncidentResolutionState | null = null;
    setResolutionState(current => {
      previousResolutionState = current;
      return {
        ...current,
        [resolutionKey]: buildReopenedIncidentResolution({
          resolutionKey,
          previous: current,
          reopenedAt,
          actor,
        }),
      };
    });

    try {
      await reopenSystemHealthIncident({
        resolutionKey,
        reopenedAt,
        actor,
      });
      success('Incidente reabierto', resolutionKey);
    } catch (reopenError) {
      if (previousResolutionState) {
        setResolutionState(previousResolutionState);
      }
      error('No se pudo reabrir el incidente', String(reopenError));
    }
  };

  const handleResolveVisibleIncidents = async () => {
    if (!canManageSystemHealthOperations) {
      notifyAdminOnlyAction();
      return;
    }

    await runResolveVisibleSystemHealthIncidentsAction({
      incidents: incidentQueue,
      actor: buildResolutionActor(),
      resolveIncident: resolveSystemHealthIncident,
      setResolutionState,
      onSuccess: count => success('Incidentes visibles marcados como resueltos', String(count)),
      onError: resolveError =>
        error('No se pudieron resolver los incidentes visibles', String(resolveError)),
    });
  };

  const handleExportCsv = () => {
    const csv = exportSystemHealthIncidentsCsv(incidentQueue);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `salud-usuarios-${selectedDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <SystemHealthTriageToolbar
        searchTerm={searchTerm}
        dateRange={dateRange}
        selectedDate={selectedDate}
        severity={severity}
        eventType={eventType}
        onSearchTermChange={setSearchTerm}
        onDateRangeChange={setDateRange}
        onSelectedDateChange={setSelectedDate}
        onSeverityChange={setSeverity}
        onEventTypeChange={setEventType}
        onShiftDate={deltaDays =>
          setSelectedDate(currentDate => shiftSystemHealthSelectedDate(currentDate, deltaDays))
        }
      />

      {loading ? (
        <div className="flex flex-col items-center justify-center py-40">
          <RefreshCw className="animate-spin text-medical-500 mb-4" size={40} />
          <p className="text-slate-400 font-medium animate-pulse">
            Cargando telemetría de usuarios...
          </p>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="card p-20 flex flex-col items-center justify-center text-slate-400">
          <Users size={48} className="mb-4 opacity-20" />
          <p className="text-lg font-medium">No hay datos de salud disponibles.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <SystemHealthSyncConvergencePanel model={syncConvergenceModel} />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_430px]">
            <SystemHealthIncidentQueue
              incidents={incidentQueue}
              selectedResolutionKey={selectedResolutionKey}
              onSelectIncident={incident => {
                setSelectedUid(incident.userUid);
                setSelectedResolutionKey(incident.resolutionKey);
              }}
              onExportCsv={handleExportCsv}
              onResolveVisibleIncidents={handleResolveVisibleIncidents}
              canManageSystemHealthOperations={canManageSystemHealthOperations}
            />

            <div className="xl:sticky xl:top-24 xl:self-start">
              <SystemHealthIncidentDetailPanel
                user={selectedUser}
                incidents={orderedSelectedIncidents}
                onDeleteSnapshot={handleDeleteSnapshot}
                onClearUserWindow={handleClearUserWindow}
                onResolveIncident={handleResolveIncident}
                onReopenIncident={handleReopenIncident}
                deleting={deletingUid === selectedUser?.uid}
                canManageSystemHealthOperations={canManageSystemHealthOperations}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
