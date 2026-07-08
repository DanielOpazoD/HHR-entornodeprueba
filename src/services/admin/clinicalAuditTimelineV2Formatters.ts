import type { AuditLogEntry } from '@/types/auditLogTypes';
import { asAuditText, getAuditLogDetails } from '@/services/admin/clinicalAuditPatientPackageKey';
import type { ClinicalAuditTimelineV2SyncState } from '@/services/admin/clinicalAuditTimelineV2Types';

const FRIENDLY_FIELD_LABELS: Record<string, string> = {
  status: 'Estado',
  Estado: 'Estado',
  diagnosis: 'Diagnóstico',
  Diagnóstico: 'Diagnóstico',
  Diagnostico: 'Diagnóstico',
  pathology: 'Diagnóstico',
  specialty: 'Especialidad',
  bedId: 'Cama',
  sourceBed: 'Cama origen',
  targetBed: 'Cama destino',
  devices: 'Dispositivos invasivos',
  'beds.*.devices': 'Dispositivos invasivos',
  handoffNoteDayShift: 'Entrega enfermería - nota día',
  'Nota de entrega de enfermería - turno día': 'Entrega enfermería - nota día',
  handoffNoteNightShift: 'Entrega enfermería - nota noche',
  'Nota de entrega de enfermería - turno noche': 'Entrega enfermería - nota noche',
  handoffNovedadesDayShift: 'Entrega enfermería - novedades día',
  'Novedades de entrega de enfermería - turno día': 'Entrega enfermería - novedades día',
  handoffNovedadesNightShift: 'Entrega enfermería - novedades noche',
  'Novedades de entrega de enfermería - turno noche': 'Entrega enfermería - novedades noche',
  medicalHandoffBySpecialty: 'Entrega médica por especialidad',
  'Entrega médica por especialidad': 'Entrega médica por especialidad',
  medicalHandoffEntries: 'Entrega médica por paciente',
  'Entradas de entrega médica por paciente': 'Entrega médica por paciente',
  medicalHandoffNovedades: 'Novedades de entrega médica',
};

export const CLINICAL_AUDIT_TIMELINE_V2_SYNC_STATE_LABELS: Record<
  ClinicalAuditTimelineV2SyncState,
  string
> = {
  accepted: 'Aceptada',
  merged: 'Merge automático',
  blocked: 'Bloqueada',
  already_applied: 'Ya aplicada',
  queued: 'En cola',
  replayed: 'Replay',
  unknown: 'Sin estado sync',
};

export const CLINICAL_AUDIT_TIMELINE_V2_SYNC_STATE_OPTION_LABELS: Record<
  ClinicalAuditTimelineV2SyncState,
  string
> = {
  accepted: 'Aceptadas',
  merged: 'Merge automático',
  blocked: 'Bloqueadas',
  already_applied: 'Ya aplicadas',
  queued: 'En cola',
  replayed: 'Replay',
  unknown: 'Sin estado sync',
};

export const CLINICAL_AUDIT_TIMELINE_V2_SYNC_STATE_ORDER: ClinicalAuditTimelineV2SyncState[] = [
  'accepted',
  'merged',
  'blocked',
  'already_applied',
  'queued',
  'replayed',
  'unknown',
];

const EMPTY_PREVIEW = '-';

export const normalizeClinicalAuditTimelineV2Token = (value: unknown): string =>
  asAuditText(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

export const normalizeClinicalAuditTimelineV2FieldLabel = (fieldLabel: string): string => {
  if (FRIENDLY_FIELD_LABELS[fieldLabel]) return FRIENDLY_FIELD_LABELS[fieldLabel];

  const pathMatch = Object.entries(FRIENDLY_FIELD_LABELS).find(([path]) => {
    if (!path.includes('*')) return false;
    const pattern = path.replace('*', '[^.]+');
    return new RegExp(`^${pattern}$`).test(fieldLabel);
  });

  return pathMatch?.[1] || fieldLabel;
};

export const formatClinicalAuditTimelineV2ValuePreview = (value: unknown): string => {
  if (value == null || value === '') return EMPTY_PREVIEW;
  if (Array.isArray(value)) {
    const arrayText = value
      .map(formatClinicalAuditTimelineV2ValuePreview)
      .filter(text => text !== EMPTY_PREVIEW);
    return arrayText.length > 0 ? arrayText.join(', ') : EMPTY_PREVIEW;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts = [
      asAuditText(record.name) || asAuditText(record.label) || asAuditText(record.type),
      asAuditText(record.installationDate),
      asAuditText(record.notes) || asAuditText(record.note),
    ].filter(Boolean);

    if (parts.length > 0) return parts.join(' · ');

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
};

export const getClinicalAuditTimelineV2ChangedPaths = (log: AuditLogEntry): string[] => {
  const details = getAuditLogDetails(log);
  const rawChangedPaths = details.changedPaths;
  if (Array.isArray(rawChangedPaths)) {
    return rawChangedPaths.map(path => asAuditText(path)).filter(Boolean);
  }

  const singlePath = asAuditText(details.changedPath) || asAuditText(details.path);
  return singlePath ? [singlePath] : [];
};

export const summarizeClinicalAuditTimelineV2SyncStates = (
  states: ClinicalAuditTimelineV2SyncState[]
): string =>
  CLINICAL_AUDIT_TIMELINE_V2_SYNC_STATE_ORDER.filter(state => states.includes(state))
    .map(state => CLINICAL_AUDIT_TIMELINE_V2_SYNC_STATE_LABELS[state])
    .join(' + ');
