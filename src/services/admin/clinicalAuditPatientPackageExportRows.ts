import type { ClinicalAuditPatientPackage } from '@/services/admin/clinicalAuditPatientPackages';
import { AUDIT_ACTION_LABELS } from '@/services/admin/auditConstants';
import { parseAuditTimestamp } from '@/services/admin/utils/auditUtils';

const CLINICAL_AUDIT_EXPORT_TIME_ZONE = 'Pacific/Easter';

export const PATIENT_PACKAGE_EXPORT_HEADERS = [
  'FECHA CENSO',
  'HORA',
  'PACIENTE',
  'RUT/ID',
  'CAMA',
  'ACCIÓN',
  'MÓDULO/VALOR',
  'ANTES',
  'DESPUÉS',
  'USUARIO',
  'IP',
  'FUENTE',
  'RESUMEN CLÍNICO',
];

export interface ClinicalAuditPatientPackageExportRow {
  packageId: string;
  censusDate: string;
  timeRange: string;
  patientName: string;
  patientRut: string;
  bedLabel: string;
  actionSummary: string;
  moduleLabel: string;
  beforeValue: string;
  afterValue: string;
  responsible: string;
  ipAddress: string;
  source: string;
  clinicalSummary: string;
}

const formatValue = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '-';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const formatTimePart = (timestamp: string): string => {
  const date = parseAuditTimestamp(timestamp);
  if (date.getTime() === 0) return '';

  return new Intl.DateTimeFormat('es-CL', {
    timeZone: CLINICAL_AUDIT_EXPORT_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
};

const buildTimeRange = (auditPackage: ClinicalAuditPatientPackage): string => {
  const startTime = formatTimePart(auditPackage.startedAt);
  const endTime = formatTimePart(auditPackage.endedAt);
  if (!startTime) return endTime || '-';
  if (!endTime || startTime === endTime) return startTime;
  return `${startTime}-${endTime}`;
};

const buildActionSummary = (auditPackage: ClinicalAuditPatientPackage): string =>
  auditPackage.actions.map(action => AUDIT_ACTION_LABELS[action] || action).join(' · ') ||
  'Actividad auditada';

const buildResponsible = (auditPackage: ClinicalAuditPatientPackage): string =>
  auditPackage.actors.map(actor => actor.label).join(', ') || 'Usuario no identificado';

const buildSource = (auditPackage: ClinicalAuditPatientPackage): string =>
  [...auditPackage.rawLogs]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map(log => log.id)
    .join(', ');

const resolveSummaryModule = (auditPackage: ClinicalAuditPatientPackage): string =>
  auditPackage.modules[0] || 'Actividad auditada';

const resolveSummaryValue = (auditPackage: ClinicalAuditPatientPackage): string => {
  if (auditPackage.flags.discharge) return 'Paciente dado de alta';
  if (auditPackage.flags.transfer) return 'Traslado registrado';
  if (auditPackage.flags.internalMovement) return 'Movimiento interno registrado';
  if (auditPackage.flags.cma) return 'CMA registrado';
  if (auditPackage.flags.conflict) return 'Conflicto sincronizado';
  return auditPackage.summary;
};

const buildBaseRow = (
  auditPackage: ClinicalAuditPatientPackage
): Omit<ClinicalAuditPatientPackageExportRow, 'moduleLabel' | 'beforeValue' | 'afterValue'> => ({
  packageId: auditPackage.id,
  censusDate: auditPackage.recordDate,
  timeRange: buildTimeRange(auditPackage),
  patientName: auditPackage.patientName,
  patientRut: auditPackage.patientRut || auditPackage.patientIdentifier || '-',
  bedLabel: auditPackage.primaryBedLabel || '-',
  actionSummary: buildActionSummary(auditPackage),
  responsible: buildResponsible(auditPackage),
  ipAddress: auditPackage.ipAddresses.join(', ') || '-',
  source: buildSource(auditPackage),
  clinicalSummary: auditPackage.summary,
});

export const buildClinicalAuditPatientPackageExportRows = (
  patientPackages: ClinicalAuditPatientPackage[]
): ClinicalAuditPatientPackageExportRow[] =>
  patientPackages.flatMap(auditPackage => {
    const baseRow = buildBaseRow(auditPackage);

    if (auditPackage.changes.length === 0) {
      return [
        {
          ...baseRow,
          moduleLabel: resolveSummaryModule(auditPackage),
          beforeValue: '-',
          afterValue: resolveSummaryValue(auditPackage),
        },
      ];
    }

    return auditPackage.changes.map(change => ({
      ...baseRow,
      moduleLabel: change.fieldLabel,
      beforeValue: formatValue(change.oldValue),
      afterValue: formatValue(change.newValue),
    }));
  });
