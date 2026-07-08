import type { AuditLogEntry } from '@/types/auditLogTypes';
import {
  buildClinicalAuditPresentation,
  type ClinicalAuditPresentation,
} from '@/services/admin/clinicalAuditPresentation';
import { UNKNOWN_AUDIT_SUBJECT } from '@/services/admin/clinicalAuditPatientPackageTypes';

export const asAuditText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeKeyPart = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

const normalizeIdentifier = (value: string): string =>
  normalizeKeyPart(value).replace(/[.\s]/g, '');

export const parseAuditTimestampMs = (timestamp: unknown): number => {
  const date =
    typeof timestamp === 'string' || typeof timestamp === 'number'
      ? new Date(timestamp)
      : timestamp instanceof Date
        ? timestamp
        : new Date(0);

  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
};

const timestampToDate = (timestamp: unknown): string => {
  const time = parseAuditTimestampMs(timestamp);
  if (!time) return '';
  return new Date(time).toISOString().slice(0, 10);
};

export const getAuditLogDetails = (log: AuditLogEntry): Record<string, unknown> =>
  log.details || {};

export const getClinicalAuditRecordDate = (log: AuditLogEntry): string => {
  const details = getAuditLogDetails(log);
  const detailRecordDate = asAuditText(details.recordDate);
  if (asAuditText(log.recordDate)) return asAuditText(log.recordDate);
  if (detailRecordDate) return detailRecordDate;
  if (log.entityType === 'dailyRecord' && /^\d{4}-\d{2}-\d{2}$/.test(log.entityId)) {
    return log.entityId;
  }
  return timestampToDate(log.timestamp) || 'fecha-desconocida';
};

const getPatientName = (log: AuditLogEntry): string => {
  const details = getAuditLogDetails(log);
  const presentation = buildClinicalAuditPresentation(log);
  return getPatientNameFromPresentation(log, presentation, details);
};

export const getPatientNameFromPresentation = (
  log: AuditLogEntry,
  presentation: ClinicalAuditPresentation,
  details = getAuditLogDetails(log)
): string => {
  return (
    asAuditText(details.patientName) ||
    (log.entityType === 'patient' || log.entityType === 'discharge' || log.entityType === 'transfer'
      ? asAuditText(presentation.affectedSubject)
      : '') ||
    UNKNOWN_AUDIT_SUBJECT
  );
};

export const getClinicalAuditPatientRut = (log: AuditLogEntry): string | undefined => {
  const details = getAuditLogDetails(log);
  return asAuditText(details.rut) || asAuditText(log.patientIdentifier) || undefined;
};

const getEpisodeKey = (log: AuditLogEntry): string | undefined => {
  const details = getAuditLogDetails(log);
  return (
    asAuditText(details.episodeKey) ||
    asAuditText(details.clinicalEpisodeId) ||
    asAuditText(details.movementId) ||
    undefined
  );
};

const looksLikeDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

interface ClinicalAuditIdentitySignals {
  episodeKey?: string;
  rut?: string;
  patientIdentifier?: string;
  entityId: string;
}

const resolveIdentitySignals = (log: AuditLogEntry): ClinicalAuditIdentitySignals => {
  const patientIdentifier = asAuditText(log.patientIdentifier);

  return {
    episodeKey: getEpisodeKey(log),
    rut: getClinicalAuditPatientRut(log),
    patientIdentifier: patientIdentifier || undefined,
    entityId: asAuditText(log.entityId),
  };
};

export const getBedLabelParts = (log: AuditLogEntry): string[] => {
  const details = getAuditLogDetails(log);
  const parts = [
    asAuditText(details.bedId),
    asAuditText(details.sourceBed),
    asAuditText(details.targetBed),
    asAuditText(details.restoredBed),
  ];

  if (
    (log.entityType === 'patient' ||
      log.entityType === 'discharge' ||
      log.entityType === 'transfer') &&
    asAuditText(log.entityId) &&
    !looksLikeDate(asAuditText(log.entityId))
  ) {
    parts.push(asAuditText(log.entityId));
  }

  return [...new Set(parts.filter(Boolean))];
};

export const getPrimaryBedLabelForLog = (log: AuditLogEntry): string | undefined => {
  const details = getAuditLogDetails(log);
  const sourceBed = asAuditText(details.sourceBed);
  const targetBed = asAuditText(details.targetBed);
  if (sourceBed && targetBed) return `${sourceBed} -> ${targetBed}`;

  const changes = details.changes;
  if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
    const bedChange = (changes as Record<string, { old?: unknown; new?: unknown }>).bedId;
    const oldBed = asAuditText(bedChange?.old);
    const newBed = asAuditText(bedChange?.new);
    if (oldBed && newBed) return `${oldBed} -> ${newBed}`;
  }

  return getBedLabelParts(log)[0];
};

const resolveIdentityPart = (
  log: AuditLogEntry,
  identity = resolveIdentitySignals(log)
): string => {
  if (identity.episodeKey) return `episode:${normalizeIdentifier(identity.episodeKey)}`;
  if (identity.rut) return `rut:${normalizeIdentifier(identity.rut)}`;
  if (identity.patientIdentifier) {
    return `patient-id:${normalizeIdentifier(identity.patientIdentifier)}`;
  }

  const patientName = getPatientName(log);
  if (patientName && patientName !== UNKNOWN_AUDIT_SUBJECT) {
    return `patient-name:${normalizeKeyPart(patientName)}`;
  }
  if (identity.entityId)
    return `entity:${normalizeKeyPart(`${log.entityType}:${identity.entityId}`)}`;
  return `unknown:${normalizeKeyPart(log.action)}`;
};

export const resolveClinicalAuditPackageKey = (log: AuditLogEntry): string => {
  const recordDate = getClinicalAuditRecordDate(log);
  const identity = resolveIdentitySignals(log);
  const identityPart = resolveIdentityPart(log, identity);
  const details = getAuditLogDetails(log);
  const hasStrongIdentity =
    Boolean(identity.episodeKey) || Boolean(identity.rut) || Boolean(identity.patientIdentifier);
  const bedLabel = asAuditText(details.bedId) || getBedLabelParts(log)[0];

  return [recordDate, identityPart, !hasStrongIdentity && bedLabel ? `bed:${bedLabel}` : '']
    .filter(Boolean)
    .join('|');
};
