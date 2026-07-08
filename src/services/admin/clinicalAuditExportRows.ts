import type { AuditLogEntry } from '@/types/auditLogTypes';
import {
  buildClinicalAuditPresentation,
  type ClinicalAuditChange,
} from '@/services/admin/clinicalAuditPresentation';
import { resolveClinicalAuditPackageContext } from '@/services/admin/clinicalAuditPackageContext';

export interface ClinicalAuditExportRow {
  id: string;
  timestamp: string;
  responsible: string;
  responsibleDetail: string;
  eventTitle: string;
  narrative: string;
  affected: string;
  origin: string;
  clinicalArea: string;
  impact: string;
  patientIdentifier: string;
  episodeId?: string;
  packageKindLabel: string;
  packageKey: string;
  packageSubject: string;
  legalTraceSummary: string;
  relevantChanges: string;
}

export const formatClinicalAuditChanges = (changes: ClinicalAuditChange[]): string => {
  if (changes.length === 0) return 'Sin cambios detallados';

  return changes
    .map(
      change =>
        `${change.fieldLabel}: ${String(change.oldValue ?? '-')} -> ${String(change.newValue ?? '-')}`
    )
    .join('; ');
};

export const buildClinicalAuditExportRows = (logs: AuditLogEntry[]): ClinicalAuditExportRow[] =>
  logs.map(log => {
    const presentation = buildClinicalAuditPresentation(log);
    const patientIdentifier = log.patientIdentifier || String(log.details?.rut || '-');
    const packageContext = resolveClinicalAuditPackageContext(
      log,
      presentation.affectedSubject,
      patientIdentifier,
      presentation.originLabel
    );

    return {
      id: log.id,
      timestamp: presentation.timestampLabel,
      responsible: presentation.actorLabel,
      responsibleDetail: presentation.actorSecondary || 'Sin identificador secundario',
      eventTitle: presentation.title,
      narrative: presentation.narrative,
      affected: presentation.affectedSubject,
      origin: presentation.originLabel,
      clinicalArea: presentation.clinicalArea,
      impact: presentation.impact,
      patientIdentifier,
      ...packageContext,
      relevantChanges: formatClinicalAuditChanges(presentation.importantChanges),
    };
  });
