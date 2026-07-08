import type { UserHealthRecentEvent } from '@/services/admin/healthService';
import type { SyncQueueOperationSnapshot } from '@/services/storage/sync';

const SYNC_CONTEXT_LABELS: Record<string, string> = {
  clinical: 'Censo diario',
  staffing: 'Dotacion',
  movements: 'Movimientos',
  handoff: 'Entrega turno',
  metadata: 'Metadata',
  unknown: 'Sincronizacion local',
};

const SYNC_FIELD_LABELS: Record<string, string> = {
  pathology: 'Diagnostico',
  specialty: 'Especialidad',
  secondarySpecialty: 'Especialidad secundaria',
  status: 'Estado',
  patientName: 'Nombre paciente',
  rut: 'RUT',
  age: 'Edad',
  admissionDate: 'Fecha de ingreso',
  admissionTime: 'Hora de ingreso',
  bedMode: 'Tipo de cupo',
  devices: 'Dispositivos',
  deviceDetails: 'Detalle dispositivos',
  clinicalEvents: 'Eventos clinicos',
  handoffNoteDayShift: 'Nota entrega dia',
  handoffNoteNightShift: 'Nota entrega noche',
  medicalHandoffNote: 'Nota medica',
  isUPC: 'UPC',
  upcChecklist: 'Checklist UPC',
  surgicalComplication: 'Complicacion quirurgica',
  isBlocked: 'Bloqueo de cama',
  blockedReason: 'Motivo de bloqueo',
};

const truncateText = (value: string, maxLength = 180): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

const toIsoTimestamp = (value: number | undefined): string => {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const buildSyncOperationModule = (operation: SyncQueueOperationSnapshot): string => {
  const contextLabels = Array.from(
    new Set((operation.contexts || []).map(context => SYNC_CONTEXT_LABELS[context] || context))
  ).filter(Boolean);

  if (contextLabels.length > 0) return contextLabels.join(' / ');
  return operation.type === 'UPDATE_DAILY_RECORD' ? 'Censo diario' : 'Paciente';
};

const buildSyncOperationMessage = (operation: SyncQueueOperationSnapshot): string => {
  if (operation.status === 'CONFLICT') return `${operation.type} con conflicto en cola local`;
  if (operation.status === 'FAILED') return `${operation.type} fallida en cola local`;
  return `${operation.type} pendiente en cola local`;
};

const buildSyncOperationSeverity = (
  operation: SyncQueueOperationSnapshot
): UserHealthRecentEvent['severity'] => {
  if (operation.status === 'FAILED' || operation.status === 'CONFLICT') return 'critical';
  if (operation.lastErrorSeverity === 'critical' || operation.lastErrorSeverity === 'high') {
    return 'critical';
  }
  return 'warning';
};

const buildSyncOperationIssue = (operation: SyncQueueOperationSnapshot): string | undefined => {
  if (operation.lastErrorCategory && operation.lastErrorCode) {
    return `${operation.lastErrorCategory}: ${operation.lastErrorCode}`;
  }
  return operation.error;
};

const getClinicalDateFromSyncKey = (key: string | undefined): string | undefined => {
  const match = /^daily:(\d{4}-\d{2}-\d{2})$/.exec(key || '');
  return match?.[1];
};

const getFieldLabelFromPath = (fieldPath: string | undefined): string | undefined => {
  if (!fieldPath) return undefined;
  const [fieldKey] = fieldPath.split('.');
  return SYNC_FIELD_LABELS[fieldKey] || fieldKey;
};

const buildSyncOperationClinicalContextSummary = (
  operation: SyncQueueOperationSnapshot
): string[] => {
  const changedPath = operation.syncContract?.changedPaths?.find(path =>
    /^beds\.[^.]+(?:\.|$)/.test(path)
  );
  if (!changedPath) return [];

  const [, bedId, ...fieldParts] = changedPath.split('.');
  const fieldKey = fieldParts.join('.');
  return [
    getClinicalDateFromSyncKey(operation.key)
      ? `fecha clinica: ${getClinicalDateFromSyncKey(operation.key)}`
      : '',
    bedId ? `cama: Cama ${bedId}` : '',
    fieldKey ? `campo: ${getFieldLabelFromPath(fieldKey)}` : 'campo: Cama completa',
    `tipo: ${operation.type}`,
  ].filter(Boolean);
};

export const buildSyncOperationHealthEvents = (
  operations: SyncQueueOperationSnapshot[] | undefined
): UserHealthRecentEvent[] =>
  (operations || [])
    .filter(operation => operation.status === 'FAILED' || operation.status === 'CONFLICT')
    .map(operation => {
      const issue = buildSyncOperationIssue(operation);
      const clinicalContextSummary = buildSyncOperationClinicalContextSummary(operation);
      return {
        id: `sync_queue:${operation.id || `${operation.type}:${operation.timestamp}`}`,
        source: 'operational',
        category: 'sync',
        severity: buildSyncOperationSeverity(operation),
        status: 'open',
        timestamp: toIsoTimestamp(operation.lastErrorAt || operation.timestamp),
        message: buildSyncOperationMessage(operation),
        operation: operation.origin || operation.recoveryPolicy || operation.type,
        module: buildSyncOperationModule(operation),
        action: operation.lastErrorAction || 'Revisar cola local y reintentar sincronizacion.',
        route: operation.key || 'Cola local del usuario',
        runtimeState: operation.status === 'CONFLICT' ? 'blocked' : undefined,
        telemetryStatus: operation.status === 'FAILED' ? 'failed' : 'degraded',
        issues: issue ? [truncateText(issue)] : [],
        contextSummary:
          clinicalContextSummary.length > 0
            ? clinicalContextSummary
            : [
                `estado: ${operation.status}`,
                `reintentos: ${operation.retryCount}`,
                operation.recoveryPolicy ? `politica: ${operation.recoveryPolicy}` : '',
                operation.contexts?.length ? `contextos: ${operation.contexts.join(', ')}` : '',
              ].filter(Boolean),
      };
    });
