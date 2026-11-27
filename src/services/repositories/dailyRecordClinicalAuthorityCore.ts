import {
  buildClinicalEpisodeKey,
  normalizeClinicalEpisodeId,
} from '@/domain/clinical-episode/clinicalEpisode';
import {
  getActiveCma,
  getActiveDischarges,
  getActiveTransfers,
} from '@/domain/movements/movementTombstonePolicy';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  resolveMovementHistoricalAdmissionDate,
  resolveMovementHistoricalAdmissionTime,
  type CMAData,
  type DischargeData,
  type TransferData,
} from '@/types/domain/movements';
import type { PatientData } from '@/types/domain/patient';

export type DailyRecordClinicalAuthorityViolationType =
  | 'duplicate_active_episode'
  | 'closed_episode_active_in_bed';

export interface DailyRecordClinicalAuthorityViolation {
  type: DailyRecordClinicalAuthorityViolationType;
  path: string;
  bedId?: string;
  episodeKey: string;
  message: string;
}

export interface DailyRecordClinicalAuthorityCoreResult {
  status: 'ok' | 'blocked';
  violations: DailyRecordClinicalAuthorityViolation[];
}

export interface EpisodeCoverageSnapshot {
  activePatients: number;
  canonicalEpisodeIds: number;
  fallbackEpisodeKeys: number;
  degenerateFallbackEpisodeKeys: number;
}

type AuthorityIdentityKind = 'episode_id' | 'document' | 'name';

interface ResolvedAuthorityEpisodeKey {
  kind: AuthorityIdentityKind;
  key: string;
  hasAdmissionTime: boolean;
}

interface ActiveEpisodeEntry {
  bedId: string;
  path: string;
  episodeKey: string;
  identityKind: AuthorityIdentityKind;
  hasAdmissionTime: boolean;
}

interface ClosedMovementEntry {
  bedId: string;
  episodeKey: string;
  identityKind: AuthorityIdentityKind;
  hasAdmissionTime: boolean;
}

type AuthorityMovement = DischargeData | TransferData | CMAData;

const normalizeText = (value: unknown): string => String(value || '').trim();

const normalizeLowerText = (value: unknown): string => normalizeText(value).toLowerCase();

const normalizeEpisodeId = (value: unknown): string =>
  normalizeClinicalEpisodeId(typeof value === 'string' ? value : String(value || ''));

const normalizeFallbackName = (value: unknown): string =>
  normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();

const resolveDocumentScopeType = (documentType: unknown): 'pasaporte' | 'rut' =>
  normalizeLowerText(documentType) === 'pasaporte' ? 'pasaporte' : 'rut';

const hasActivePatientIdentity = (patient: PatientData | undefined): patient is PatientData =>
  Boolean(
    patient &&
    !patient.isBlocked &&
    (normalizeEpisodeId(patient.clinicalEpisodeId) ||
      normalizeLowerText(patient.rut) ||
      normalizeLowerText(patient.patientName) ||
      normalizeLowerText(patient.admissionDate))
  );

const buildFallbackEpisodeKey = ({
  clinicalEpisodeId,
  documentValue,
  documentType,
  patientName,
  admissionDate,
  admissionTime,
  isCribScope,
}: {
  clinicalEpisodeId?: unknown;
  documentValue?: unknown;
  documentType?: unknown;
  patientName?: unknown;
  admissionDate?: unknown;
  admissionTime?: unknown;
  isCribScope: boolean;
}): ResolvedAuthorityEpisodeKey | null => {
  const persistedEpisodeId = normalizeEpisodeId(clinicalEpisodeId);
  if (persistedEpisodeId) {
    return {
      kind: 'episode_id',
      key: persistedEpisodeId,
      hasAdmissionTime: true,
    };
  }

  const scope = isCribScope ? 'crib' : 'bed';
  const normalizedAdmissionDate = normalizeText(admissionDate);
  const normalizedAdmissionTime = normalizeText(admissionTime);
  const normalizedDocument = normalizeLowerText(documentValue);

  if (normalizedDocument) {
    const docType = resolveDocumentScopeType(documentType);
    const key = buildClinicalEpisodeKey(
      `${scope}:${docType}:${normalizedDocument}`,
      normalizedAdmissionDate || undefined,
      normalizedAdmissionTime || undefined
    );
    return {
      kind: 'document',
      key,
      hasAdmissionTime: Boolean(normalizedAdmissionTime),
    };
  }

  // ID-01: normalized name is only a fallback when document is absent AND episode context exists.
  const normalizedName = normalizeFallbackName(patientName);
  if (!normalizedName || !normalizedAdmissionDate) {
    return null;
  }

  const key = buildClinicalEpisodeKey(
    `${scope}:name:${normalizedName}`,
    normalizedAdmissionDate,
    normalizedAdmissionTime || undefined
  );
  return {
    kind: 'name',
    key,
    hasAdmissionTime: Boolean(normalizedAdmissionTime),
  };
};

const resolvePatientAuthorityKey = (
  patient: PatientData,
  isNestedCrib: boolean
): ResolvedAuthorityEpisodeKey | null =>
  buildFallbackEpisodeKey({
    clinicalEpisodeId: patient.clinicalEpisodeId,
    documentValue: patient.rut,
    documentType: patient.documentType,
    patientName: patient.patientName,
    admissionDate: patient.firstSeenDate || patient.admissionDate,
    admissionTime: patient.admissionTime,
    // ID-03: mother's RUN links mother and newborn without making them the same person.
    isCribScope: isNestedCrib || patient.bedMode === 'Cuna',
  });

const isMovementCribScope = (movement: AuthorityMovement): boolean =>
  ('isNested' in movement && movement.isNested === true) ||
  movement.originalData?.bedMode === 'Cuna' ||
  ('bedType' in movement && movement.bedType === 'Cuna');

const resolveMovementBedId = (movement: AuthorityMovement): string =>
  normalizeText('bedId' in movement ? movement.bedId : movement.originalBedId);

const resolveMovementAuthorityKey = (
  movement: AuthorityMovement
): ResolvedAuthorityEpisodeKey | null =>
  buildFallbackEpisodeKey({
    clinicalEpisodeId: movement.clinicalEpisodeId,
    documentValue: movement.rut,
    documentType: movement.originalData?.documentType,
    patientName: movement.patientName,
    admissionDate: resolveMovementHistoricalAdmissionDate(movement),
    admissionTime: resolveMovementHistoricalAdmissionTime(movement),
    isCribScope: isMovementCribScope(movement),
  });

const collectActiveEpisodeEntries = (
  record: Partial<DailyRecord> | null | undefined
): ActiveEpisodeEntry[] => {
  const entries: ActiveEpisodeEntry[] = [];

  Object.entries(record?.beds || {}).forEach(([bedId, patient]) => {
    if (hasActivePatientIdentity(patient)) {
      const resolved = resolvePatientAuthorityKey(patient, false);
      if (resolved) {
        entries.push({
          bedId,
          path: `beds.${bedId}`,
          episodeKey: resolved.key,
          identityKind: resolved.kind,
          hasAdmissionTime: resolved.hasAdmissionTime,
        });
      }
    }

    if (hasActivePatientIdentity(patient?.clinicalCrib)) {
      const resolved = resolvePatientAuthorityKey(patient.clinicalCrib, true);
      if (resolved) {
        entries.push({
          bedId,
          path: `beds.${bedId}.clinicalCrib`,
          episodeKey: resolved.key,
          identityKind: resolved.kind,
          hasAdmissionTime: resolved.hasAdmissionTime,
        });
      }
    }
  });

  return entries;
};

const collectClosedMovementEntries = (
  record: Partial<DailyRecord> | null | undefined
): ClosedMovementEntry[] => {
  const entries: ClosedMovementEntry[] = [];
  const append = (movement: AuthorityMovement) => {
    const resolved = resolveMovementAuthorityKey(movement);
    if (!resolved) {
      return;
    }
    entries.push({
      bedId: resolveMovementBedId(movement),
      episodeKey: resolved.key,
      identityKind: resolved.kind,
      hasAdmissionTime: resolved.hasAdmissionTime,
    });
  };

  getActiveDischarges(record?.discharges).forEach(append);
  getActiveTransfers(record?.transfers).forEach(append);
  getActiveCma(record?.cma).forEach(append);
  return entries;
};

const collectDuplicateEpisodeViolations = (
  activeEpisodes: ActiveEpisodeEntry[]
): DailyRecordClinicalAuthorityViolation[] => {
  const seen = new Map<string, ActiveEpisodeEntry>();
  const violations: DailyRecordClinicalAuthorityViolation[] = [];

  activeEpisodes.forEach(entry => {
    // ID-01: name alone without document or episode id cannot distinguish homonyms.
    if (entry.identityKind === 'name') {
      return;
    }

    const previous = seen.get(entry.episodeKey);
    if (!previous) {
      seen.set(entry.episodeKey, entry);
      return;
    }

    violations.push({
      type: 'duplicate_active_episode',
      path: entry.path,
      bedId: entry.bedId,
      episodeKey: entry.episodeKey,
      message: `Episodio clinico activo duplicado en ${previous.path} y ${entry.path}.`,
    });
  });

  return violations;
};

const collectClosedEpisodeViolations = (
  activeEpisodes: ActiveEpisodeEntry[],
  closedMovements: ClosedMovementEntry[]
): DailyRecordClinicalAuthorityViolation[] => {
  const closedByKey = new Map<string, ClosedMovementEntry[]>();
  closedMovements.forEach(movement => {
    const list = closedByKey.get(movement.episodeKey) ?? [];
    list.push(movement);
    closedByKey.set(movement.episodeKey, list);
  });

  const activeNameCounts = new Map<string, number>();
  activeEpisodes.forEach(entry => {
    if (entry.identityKind === 'name') {
      activeNameCounts.set(entry.episodeKey, (activeNameCounts.get(entry.episodeKey) ?? 0) + 1);
    }
  });

  const violations: DailyRecordClinicalAuthorityViolation[] = [];

  activeEpisodes.forEach(entry => {
    const matchingMovements = closedByKey.get(entry.episodeKey);
    if (!matchingMovements || matchingMovements.length === 0) {
      return;
    }

    if (entry.identityKind === 'name') {
      // ID-01: name fallback requires a single active candidate plus episode context
      // (either the same bed or a matching admission time on both sides).
      if ((activeNameCounts.get(entry.episodeKey) ?? 0) !== 1) {
        return;
      }

      const hasUnequivocalMatch = matchingMovements.some(
        movement =>
          (entry.hasAdmissionTime && movement.hasAdmissionTime) ||
          (Boolean(movement.bedId) && movement.bedId === entry.bedId)
      );
      if (!hasUnequivocalMatch) {
        return;
      }
    }

    violations.push({
      type: 'closed_episode_active_in_bed',
      path: entry.path,
      bedId: entry.bedId,
      episodeKey: entry.episodeKey,
      message: `Episodio clinico ${entry.episodeKey} permanece activo en cama pese a movimiento de cierre.`,
    });
  });

  return violations;
};

export const evaluateDailyRecordClinicalAuthorityCore = (
  record: Partial<DailyRecord> | null | undefined
): DailyRecordClinicalAuthorityCoreResult => {
  const activeEpisodes = collectActiveEpisodeEntries(record);
  const closedMovements = collectClosedMovementEntries(record);
  const violations = [
    ...collectDuplicateEpisodeViolations(activeEpisodes),
    ...collectClosedEpisodeViolations(activeEpisodes, closedMovements),
  ];

  return {
    status: violations.length > 0 ? 'blocked' : 'ok',
    violations,
  };
};

export const collectClinicalEpisodeCoverage = (
  record: Partial<DailyRecord> | null | undefined
): EpisodeCoverageSnapshot => {
  const snapshot: EpisodeCoverageSnapshot = {
    activePatients: 0,
    canonicalEpisodeIds: 0,
    fallbackEpisodeKeys: 0,
    degenerateFallbackEpisodeKeys: 0,
  };

  const visit = (patient: PatientData | undefined) => {
    if (!hasActivePatientIdentity(patient)) {
      return;
    }

    snapshot.activePatients += 1;
    if (normalizeEpisodeId(patient.clinicalEpisodeId)) {
      snapshot.canonicalEpisodeIds += 1;
      return;
    }

    snapshot.fallbackEpisodeKeys += 1;
    if (!normalizeLowerText(patient.rut) || !normalizeText(patient.admissionTime)) {
      snapshot.degenerateFallbackEpisodeKeys += 1;
    }
  };

  Object.values(record?.beds || {}).forEach(patient => {
    visit(patient);
    visit(patient?.clinicalCrib);
  });

  return snapshot;
};
