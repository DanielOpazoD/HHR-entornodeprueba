import type { AuditLogEntry } from '@/types/auditLogTypes';

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export const normalizeAuditPackageToken = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]+/g, '');

export const resolveClinicalAuditEpisodeId = (log: AuditLogEntry): string | undefined => {
  const details = log.details || {};
  const direct =
    asText(details.clinicalEpisodeId) || asText(details.episodeKey) || asText(details.episodeId);
  if (direct) return direct;

  const patient = asRecord(details.patient);
  return asText(patient?.clinicalEpisodeId) || asText(patient?.episodeKey) || undefined;
};

export const resolveClinicalAuditPackageContext = (
  log: AuditLogEntry,
  affected: string,
  patientIdentifier: string,
  origin: string
) => {
  const episodeId = resolveClinicalAuditEpisodeId(log);
  const packageKindLabel = episodeId ? 'Paquete por episodio' : 'Paquete por paciente';
  const patientLabel = patientIdentifier !== '-' ? `RUT/ID ${patientIdentifier}` : '';
  const packageSubject = episodeId
    ? `Episodio ${episodeId}`
    : patientLabel || affected || log.entityId || log.entityType;
  const packageKey = episodeId
    ? `episode:${normalizeAuditPackageToken(episodeId)}`
    : patientLabel
      ? `patient:${normalizeAuditPackageToken(patientIdentifier)}`
      : `subject:${normalizeAuditPackageToken(affected || log.entityId || log.entityType)}`;

  const legalTraceSummary = [
    packageKindLabel,
    affected,
    episodeId ? `Episodio ${episodeId}` : '',
    patientLabel,
    origin,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    episodeId,
    packageKindLabel,
    packageKey,
    packageSubject,
    legalTraceSummary,
  };
};
