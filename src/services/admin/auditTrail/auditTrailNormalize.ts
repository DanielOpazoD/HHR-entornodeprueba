import type { AuditLogEntry } from '@/types/auditLogTypes';
import type { AuditTrailChange, AuditTrailEvent, AuditTrailStatus } from '@/types/auditTrailTypes';
import { resolveAuditTrailAction } from '@/services/admin/auditTrail/auditTrailCatalog';
import { describeConflictAutoMerge } from '@/services/admin/auditTrail/auditTrailConflicts';
import {
  attachNamelessPatients,
  resolveAuditTrailActor,
  resolveAuditTrailBed,
  resolveAuditTrailPatient,
  splitPatientKeyByDocument,
  unifyAuditTrailActorNames,
} from '@/services/admin/auditTrail/auditTrailIdentity';
import {
  MAX_VALUE_LENGTH,
  asAuditText,
  formatAuditTrailDuration,
  formatAuditTrailValue,
  resolveAuditTrailFieldLabel,
} from '@/services/admin/auditTrail/auditTrailValues';
import { excerptAroundChange } from '@/services/admin/auditTextExcerpt';
import { formatClinicalDayMonthYear } from '@/utils/clinicalTimeFormat';

const MAX_CHANGES = 12;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts ISO strings, epoch numbers and Firestore timestamps (`toDate()` or `seconds`). */
export const parseAuditTrailTimestamp = (value: unknown): number | null => {
  if (typeof value === 'string' || typeof value === 'number') {
    const epochMs = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(epochMs) && epochMs > 0 ? epochMs : null;
  }
  if (value instanceof Date) return parseAuditTrailTimestamp(value.getTime());
  if (value && typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; seconds?: unknown };
    if (typeof candidate.toDate === 'function') return parseAuditTrailTimestamp(candidate.toDate());
    if (typeof candidate.seconds === 'number') return candidate.seconds * 1000;
  }
  return null;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

const toChange = (field: string, before: unknown, after: unknown): AuditTrailChange | null => {
  // Long texts are compared whole, then shown around their first difference.
  if (typeof before === 'string' && typeof after === 'string') {
    const [whole, wholeAfter] = [collapse(before), collapse(after)];
    if (whole === wholeAfter) return null;
    if (whole.length > MAX_VALUE_LENGTH || wholeAfter.length > MAX_VALUE_LENGTH) {
      const excerpt = excerptAroundChange(whole, wholeAfter, MAX_VALUE_LENGTH);
      return { field, before: excerpt.before || undefined, after: excerpt.after || undefined };
    }
  }
  const formattedBefore = formatAuditTrailValue(before);
  const formattedAfter = formatAuditTrailValue(after);
  if (formattedBefore === formattedAfter) return null;
  return { field, before: formattedBefore, after: formattedAfter };
};

const extractChangeMap = (changes: Record<string, unknown>): AuditTrailChange[] =>
  Object.entries(changes).flatMap(([field, change]) => {
    if (!isPlainObject(change)) return [];
    if (field === 'deviceDetails') {
      return Object.entries(change).flatMap(([device, deviceChange]) =>
        isPlainObject(deviceChange)
          ? [toChange(`Dispositivo ${device}`, deviceChange.old, deviceChange.new)]
          : []
      );
    }
    if (!('old' in change) && !('new' in change)) return [];
    return [toChange(resolveAuditTrailFieldLabel(field), change.old, change.new)];
  }) as AuditTrailChange[];

const extractChanges = (details: Record<string, unknown>): AuditTrailChange[] => {
  const changes: (AuditTrailChange | null)[] = [];

  if (isPlainObject(details.changes)) {
    changes.push(...extractChangeMap(details.changes));
  } else if (asAuditText(details.field) && ('oldValue' in details || 'newValue' in details)) {
    changes.push(
      toChange(
        resolveAuditTrailFieldLabel(asAuditText(details.field)),
        details.oldValue,
        details.newValue ?? details.value
      )
    );
  }

  const sourceBed = asAuditText(details.sourceBed);
  const targetBed = asAuditText(details.targetBed);
  if (sourceBed && targetBed && !changes.some(change => change?.field === 'Cama')) {
    changes.unshift({ field: 'Cama', before: sourceBed, after: targetBed });
  }

  return changes
    .filter((change): change is AuditTrailChange => change !== null)
    .slice(0, MAX_CHANGES);
};

/** Automatic ends: 8 h without activity, nursing shift end or revoked access. */
const LOGOUT_LABELS: Record<string, string> = {
  automatic: 'Cierre automático',
  inactivity: 'Cierre automático',
  expired: 'Cierre automático',
  closed: 'Desconexión',
};

const MOVEMENT_LABELS: Record<string, string> = {
  move: 'Cambio de cama',
  copy: 'Copia de paciente',
  undo_discharge: 'Alta revertida',
};

const resolveLabel = (
  log: AuditLogEntry,
  details: Record<string, unknown>,
  baseLabel: string,
  changes: AuditTrailChange[]
): string => {
  const movementLabel = MOVEMENT_LABELS[asAuditText(details.movementKind)];
  if (
    (log.action === 'PATIENT_MODIFIED' || log.action === 'PATIENT_BED_CHANGED') &&
    movementLabel
  ) {
    return movementLabel;
  }
  // "Edad: 40 → 41" says it all; the generic "Edición" only remains for several fields.
  if (log.action === 'PATIENT_MODIFIED' && changes.length === 1) return changes[0].field;
  if (log.action === 'USER_LOGIN' && details.start === 'resume') return 'Reconexión';
  if (log.action === 'USER_LOGOUT') {
    return LOGOUT_LABELS[asAuditText(details.reason)] ?? baseLabel;
  }
  return baseLabel;
};

const SHIFT_LABELS: Record<string, string> = { day: 'Turno día', night: 'Turno noche' };

const resolveDetail = (
  log: AuditLogEntry,
  details: Record<string, unknown>
): string | undefined => {
  const bed = resolveAuditTrailBed(log, details);
  const shift = SHIFT_LABELS[asAuditText(details.shift)];
  const durationMs =
    typeof details.durationSeconds === 'number' ? details.durationSeconds * 1000 : undefined;

  switch (log.action) {
    case 'PATIENT_ADMITTED':
    case 'PATIENT_CLEARED':
    case 'BED_UNBLOCKED':
      return bed;
    case 'PATIENT_DISCHARGED':
      return asAuditText(details.status) || undefined;
    case 'PATIENT_TRANSFERRED':
      return asAuditText(details.destination) || undefined;
    case 'PATIENT_DISCHARGE_DIAGNOSIS_CHANGED':
    case 'PATIENT_DISCHARGE_RECLASSIFIED':
      return asAuditText(details.movementLabel) || undefined;
    case 'BED_BLOCKED':
      return [bed, asAuditText(details.reason)].filter(Boolean).join(' · ') || undefined;
    case 'EXTRA_BED_TOGGLED':
      return [bed, details.active === false ? 'desactivada' : 'activada']
        .filter(Boolean)
        .join(' · ');
    case 'DAILY_RECORD_CREATED': {
      const copiedFrom = asAuditText(details.copiedFrom);
      return copiedFrom ? `copia de ${formatClinicalDayMonthYear(copiedFrom)}` : undefined;
    }
    case 'NURSE_HANDOFF_MODIFIED':
    case 'HANDOFF_NOVEDADES_MODIFIED':
      return shift;
    case 'MEDICAL_HANDOFF_SIGNED':
      return asAuditText(details.doctorName) || undefined;
    case 'CUDYR_BATCH_SAVED':
      return typeof details.patientCount === 'number'
        ? `${details.patientCount} pacientes`
        : undefined;
    case 'USER_LOGIN':
      return asAuditText(log.device) || asAuditText(details.device) || undefined;
    case 'USER_LOGOUT':
    case 'CONNECTION_INTERRUPTED':
      return durationMs ? formatAuditTrailDuration(durationMs) : undefined;
    case 'DATA_IMPORTED':
      return typeof details.recordCount === 'number' ? `${details.recordCount} días` : undefined;
    default:
      return (
        asAuditText(details.documentTitle) ||
        asAuditText(details.title) ||
        (log.entityType === 'patient' ? undefined : bed)
      );
  }
};

const REVIEW_TOKENS = new Set(['blocked', 'needs_review', 'not_possible', 'rejected', 'partial']);
const AUTO_TOKENS = new Set([
  'auto_merged',
  'merged',
  'auto_merge',
  'conflict_auto_merged',
  'already_applied',
  'duplicate',
  'idempotent',
  'replayed',
  'replay',
]);
const AUTO_ACTIONS = new Set(['CONFLICT_AUTO_MERGED', 'PRESCRIPTION_RETENTION_DELETED']);

const resolveStatus = (
  log: AuditLogEntry,
  details: Record<string, unknown>,
  review: boolean | undefined
): AuditTrailStatus => {
  const tokens = [details.syncStatus, details.resolution, details.queueStatus, details.outcome]
    .map(value => asAuditText(value).toLowerCase())
    .filter(Boolean);
  if (review || tokens.some(token => REVIEW_TOKENS.has(token))) return 'review';
  if (AUTO_ACTIONS.has(log.action) || tokens.some(token => AUTO_TOKENS.has(token))) return 'auto';
  return 'ok';
};

const resolveCensusDate = (
  log: AuditLogEntry,
  details: Record<string, unknown>
): string | undefined => {
  const candidates = [log.recordDate, details.recordDate, details.date];
  if (log.entityType === 'dailyRecord') candidates.push(log.entityId);
  return candidates.map(asAuditText).find(value => DATE_ONLY.test(value));
};

export const normalizeAuditTrailEvent = (log: AuditLogEntry): AuditTrailEvent | null => {
  const at = parseAuditTrailTimestamp(log.timestamp);
  if (at === null || !log.action) return null;

  const details = isPlainObject(log.details) ? log.details : {};
  const entry = resolveAuditTrailAction(log.action);
  const changes = extractChanges(details);
  const isPatientEvent = entry.category === 'change' || entry.category === 'access';
  const conflict =
    log.action === 'CONFLICT_AUTO_MERGED' ? describeConflictAutoMerge(details) : undefined;

  return {
    id: asAuditText(log.id) || `${log.action}-${at}`,
    at,
    category: entry.category,
    status: conflict?.review ? 'review' : resolveStatus(log, details, entry.review),
    area: entry.area,
    action: log.action,
    label: resolveLabel(log, details, entry.label, changes),
    detail: conflict ? conflict.detail : resolveDetail(log, details),
    changes,
    notes: conflict && conflict.notes.length > 0 ? conflict.notes : undefined,
    patient: isPatientEvent ? resolveAuditTrailPatient(log, details) : undefined,
    actor: resolveAuditTrailActor(log),
    authors: asAuditText(log.authors) || undefined,
    censusDate: resolveCensusDate(log, details),
    sessionId: asAuditText(log.sessionId) || asAuditText(details.sessionId) || undefined,
    device: asAuditText(log.device) || asAuditText(details.device) || undefined,
    ipAddress: asAuditText(log.ipAddress) || undefined,
    source: log,
  };
};

/** Stored documents → display events, newest first, with one name per person and patient. */
export const normalizeAuditTrailEvents = (logs: AuditLogEntry[]): AuditTrailEvent[] => {
  const seen = new Set<string>();
  const events = logs
    .map(normalizeAuditTrailEvent)
    .filter((event): event is AuditTrailEvent => {
      if (!event || seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .sort((a, b) => b.at - a.at);
  return splitPatientKeyByDocument(attachNamelessPatients(unifyAuditTrailActorNames(events)));
};
