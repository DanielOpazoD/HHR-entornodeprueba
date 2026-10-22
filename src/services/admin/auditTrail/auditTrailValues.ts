import { CUDYR_REPORT_ITEM_LABELS } from '@/services/cudyr/cudyrReportItemLabels';
import { truncateText } from '@/services/admin/auditTextExcerpt';
import { formatClinicalClock, formatClinicalDayMonthYear } from '@/utils/clinicalTimeFormat';

/** Longest before/after text shown in a line; the rest stays in the technical detail. */
export const MAX_VALUE_LENGTH = 280;

export const AUDIT_TRAIL_FIELD_LABELS: Record<string, string> = {
  ...CUDYR_REPORT_ITEM_LABELS,
  patientName: 'Nombre',
  rut: 'RUT',
  age: 'Edad',
  biologicalSex: 'Sexo',
  insurance: 'Previsión',
  admissionOrigin: 'Origen de ingreso',
  origin: 'Procedencia',
  admissionDate: 'Fecha de ingreso',
  admissionTime: 'Hora de ingreso',
  pathology: 'Diagnóstico',
  diagnosis: 'Diagnóstico',
  specialty: 'Especialidad',
  secondarySpecialty: 'Especialidad secundaria',
  status: 'Estado',
  bedId: 'Cama',
  sourceBed: 'Cama origen',
  targetBed: 'Cama destino',
  note: 'Nota',
  novedades: 'Novedades',
  content: 'Novedades',
  deviceDetails: 'Dispositivos',
  handoffNote: 'Nota de entrega',
  handoffNoteDayShift: 'Nota turno día',
  handoffNoteNightShift: 'Nota turno noche',
  handoffNovedadesDayShift: 'Novedades turno día',
  handoffNovedadesNightShift: 'Novedades turno noche',
  medicalHandoffNote: 'Entrega médica',
  medicalHandoffNovedades: 'Novedades médicas',
  reason: 'Motivo',
  active: 'Activa',
  score: 'Puntaje',
  category: 'Categoría',
  documentTitle: 'Documento',
  doctorName: 'Médico',
  destination: 'Destino',
};

export const resolveAuditTrailFieldLabel = (field: string): string => {
  if (AUDIT_TRAIL_FIELD_LABELS[field]) return AUDIT_TRAIL_FIELD_LABELS[field];
  const lastSegment = field.split('.').pop() || field;
  return AUDIT_TRAIL_FIELD_LABELS[lastSegment] || lastSegment;
};

export const asAuditText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const truncate = (value: string): string => truncateText(value, MAX_VALUE_LENGTH);

const formatDeviceValue = (value: Record<string, unknown>): string => {
  const installedAt = asAuditText(value.installationDate);
  const notes = asAuditText(value.notes);
  return [installedAt ? `instalado ${formatClinicalDayMonthYear(installedAt)}` : '', notes]
    .filter(Boolean)
    .join(' · ');
};

/** Compact, human value for a before/after column. Empty values return `undefined`. */
export const formatAuditTrailValue = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
  if (Array.isArray(value)) {
    const items = value.map(formatAuditTrailValue).filter(Boolean);
    return items.length > 0 ? truncate(items.join(', ')) : undefined;
  }
  if (typeof value === 'object') {
    const text = formatDeviceValue(value as Record<string, unknown>);
    return text || undefined;
  }
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text || text === 'N/A') return undefined;
  if (text === 'Eliminado') return 'Retirado';
  if (DATE_ONLY.test(text)) return formatClinicalDayMonthYear(text);
  if (ISO_INSTANT.test(text)) {
    const epochMs = Date.parse(text);
    if (Number.isFinite(epochMs)) {
      return `${formatClinicalDayMonthYear(epochMs)} ${formatClinicalClock(epochMs)}`;
    }
  }
  return truncate(text);
};

/** `1 h 05 m`, `12 m`, `45 s`. */
export const formatAuditTrailDuration = (milliseconds: number): string => {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} h ${String(minutes).padStart(2, '0')} m`;
};

/** Normalized text for case- and accent-insensitive search and grouping keys. */
export const normalizeAuditTrailText = (value: string): string =>
  value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
