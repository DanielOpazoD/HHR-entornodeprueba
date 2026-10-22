import type { AuditLogEntry } from '@/types/auditLogTypes';
import type { AuditTrailActor, AuditTrailEvent, AuditTrailPatient } from '@/types/auditTrailTypes';
import { asAuditText, normalizeAuditTrailText } from '@/services/admin/auditTrail/auditTrailValues';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CRIB_SUFFIX = '-crib';

/** Bed of the event as shown to people: `H3C2`, or `H3C2 · cuna` for the newborn's crib. */
export const resolveAuditTrailBed = (
  log: AuditLogEntry,
  details: Record<string, unknown>
): string | undefined => {
  // Patient events are keyed by bed; discharge and transfer events may be keyed by movement.
  const entityBed =
    log.entityType === 'patient' && !DATE_ONLY.test(asAuditText(log.entityId))
      ? asAuditText(log.entityId)
      : '';
  const bed =
    asAuditText(details.targetBed) ||
    asAuditText(details.bedId) ||
    asAuditText(details.restoredBed) ||
    entityBed;
  if (!bed) return undefined;
  return bed.endsWith(CRIB_SUFFIX) ? `${bed.slice(0, -CRIB_SUFFIX.length)} · cuna` : bed;
};

/**
 * Patient behind the event. People are grouped by name; the document only tells apart two
 * different people who share a name (see `splitPatientKeyByDocument`). Documents are kept
 * verbatim: passports are never rewritten as RUT.
 */
export const resolveAuditTrailPatient = (
  log: AuditLogEntry,
  details: Record<string, unknown>
): AuditTrailPatient | undefined => {
  const name = asAuditText(details.patientName);
  const document =
    asAuditText(details.rut) ||
    asAuditText(details.patientRut) ||
    asAuditText(details.patientDocument) ||
    asAuditText(log.patientIdentifier);
  if (!name && !document) return undefined;

  const episodeId =
    asAuditText(details.clinicalEpisodeId) || asAuditText(details.episodeKey) || undefined;
  return {
    key: name ? `name:${normalizeAuditTrailText(name)}` : `doc:${normalizeDocument(document)}`,
    name: name || document,
    document: document || undefined,
    episodeId,
    bedId: resolveAuditTrailBed(log, details),
  };
};

/** Formatting only: `22.222.222-2` and `222222222` are the same document; letters stay. */
export const normalizeDocument = (document: string): string =>
  document.toUpperCase().replace(/[.\s-]/g, '');

/** A masked identifier (`12345***-*`) only narrows the patient; it never splits a group. */
export const isMaskedDocument = (document: string | undefined): boolean =>
  Boolean(document?.includes('*'));

const SERVICE_ACTOR_NAMES: Record<string, string> = {
  'public-signature-link': 'Firma pública',
  'mobile-qr-upload': 'Carga móvil QR',
  system: 'Sistema',
};

const nameFromEmail = (email: string): string =>
  email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export const resolveAuditTrailActor = (log: AuditLogEntry): AuditTrailActor => {
  const userId = asAuditText(log.userId);
  const uid = asAuditText(log.userUid) || undefined;
  const email = userId.includes('@') ? userId.toLowerCase() : undefined;
  const key = (email || userId || uid || 'sin-identificar').toLowerCase();
  const name =
    asAuditText(log.userDisplayName) ||
    SERVICE_ACTOR_NAMES[userId] ||
    (email ? nameFromEmail(email) : userId) ||
    'Sin identificar';
  return { key, name, email, uid };
};

/**
 * One display name per staff member: the name used most often in the loaded period (Google
 * profiles and account names differ, e.g. "Daniel Opazo" and "Daniel Opazo Damiani").
 */
export const unifyAuditTrailActorNames = (events: AuditTrailEvent[]): AuditTrailEvent[] => {
  const tallies = new Map<string, Map<string, number>>();
  events.forEach(event => {
    const names = tallies.get(event.actor.key) ?? new Map<string, number>();
    names.set(event.actor.name, (names.get(event.actor.name) ?? 0) + 1);
    tallies.set(event.actor.key, names);
  });

  const preferred = new Map<string, string>();
  tallies.forEach((names, key) => {
    const [name] = [...names.entries()].sort(
      ([nameA, countA], [nameB, countB]) => countB - countA || nameB.length - nameA.length
    )[0];
    preferred.set(key, name);
  });

  return events.map(event => {
    const name = preferred.get(event.actor.key) ?? event.actor.name;
    return name === event.actor.name ? event : { ...event, actor: { ...event.actor, name } };
  });
};

/**
 * Events that carry only a document (clinical documents) join the named patient with that
 * document, unless the document belongs to more than one name (mother and newborn).
 */
export const attachNamelessPatients = (events: AuditTrailEvent[]): AuditTrailEvent[] => {
  const namesByDocument = new Map<string, Map<string, AuditTrailPatient>>();
  events.forEach(event => {
    const patient = event.patient;
    if (
      !patient?.document ||
      patient.key.startsWith('doc:') ||
      isMaskedDocument(patient.document)
    ) {
      return;
    }
    const document = normalizeDocument(patient.document);
    const names = namesByDocument.get(document) ?? new Map<string, AuditTrailPatient>();
    names.set(patient.key, patient);
    namesByDocument.set(document, names);
  });

  return events.map(event => {
    const patient = event.patient;
    if (!patient?.key.startsWith('doc:') || !patient.document) return event;
    const names = namesByDocument.get(normalizeDocument(patient.document));
    if (!names || names.size !== 1) return event;
    const [named] = names.values();
    return { ...event, patient: { ...named, bedId: patient.bedId ?? named.bedId } };
  });
};

/** The visible characters of a masked document: `12.345.***-*` → `12345`. */
const visibleDocumentPrefix = (document: string): string =>
  normalizeDocument(document).split('*')[0];

/** The one full document a (possibly masked) document belongs to, if any. */
const resolveDocumentOwner = (
  document: string | undefined,
  fullDocuments: Set<string>
): string | undefined => {
  if (!document) return undefined;
  if (!isMaskedDocument(document)) return normalizeDocument(document);
  const prefix = visibleDocumentPrefix(document);
  const matches = [...fullDocuments].filter(full => prefix.length > 0 && full.startsWith(prefix));
  return matches.length === 1 ? matches[0] : undefined;
};

/**
 * Same name, different full documents: two people. A masked document joins the one whose visible
 * characters it shares; an event whose owner is unclear (no document, or a masked one that fits
 * none or both) stays apart instead of being shown under either person.
 */
export const splitPatientKeyByDocument = (events: AuditTrailEvent[]): AuditTrailEvent[] => {
  const documentsByKey = new Map<string, Set<string>>();
  events.forEach(event => {
    const document = event.patient?.document;
    if (!event.patient || !document || isMaskedDocument(document)) return;
    const documents = documentsByKey.get(event.patient.key) ?? new Set<string>();
    documents.add(normalizeDocument(document));
    documentsByKey.set(event.patient.key, documents);
  });

  return events.map(event => {
    const patient = event.patient;
    const documents = patient ? documentsByKey.get(patient.key) : undefined;
    if (!patient || !documents || documents.size < 2) return event;
    const owner = resolveDocumentOwner(patient.document, documents);
    return { ...event, patient: { ...patient, key: `${patient.key}|doc:${owner ?? 'unclear'}` } };
  });
};
