import type {
  RayenCensusSnapshot,
  RayenEncounter,
  RayenSyncBundle,
} from '../contracts/rayenSnapshot';

export const RAYEN_IMPORT_MESSAGE_TYPE = 'HHR_RAYEN_CENSUS_SNAPSHOT';
export const RAYEN_IMPORT_ERROR_MESSAGE_TYPE = 'HHR_RAYEN_IMPORT_ERROR';
export const RAYEN_REQUEST_MESSAGE_TYPE = 'HHR_RAYEN_REQUEST_SNAPSHOT';
export const RAYEN_SYNC_BUNDLE_REQUEST_MESSAGE_TYPE = 'HHR_RAYEN_REQUEST_SYNC_BUNDLE';
const MAX_SOURCE_SKEW_MS = 2 * 60 * 1000;

interface RayenImportMessage {
  type: typeof RAYEN_IMPORT_MESSAGE_TYPE;
  requestId: string;
  snapshot: RayenCensusSnapshot;
  bundle: RayenSyncBundle;
}

const isEncounter = (value: unknown): value is RayenEncounter => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.encounterId === 'string' &&
    typeof candidate.run === 'string' &&
    typeof candidate.firstGivenName === 'string' &&
    typeof candidate.firstFamilyName === 'string' &&
    (candidate.treatingPhysicianId === undefined ||
      typeof candidate.treatingPhysicianId === 'string') &&
    (candidate.treatingPhysicianName === undefined ||
      typeof candidate.treatingPhysicianName === 'string') &&
    // Placement proof and configured specialty are HHR-only enrichments produced after the raw
    // snapshot is validated. The extension is never authoritative for either value.
    candidate.verifiedBedPlacement === undefined &&
    candidate.treatingPhysicianSpecialty === undefined
  );
};

const isTreatingPhysician = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.practitionerId === 'string' &&
    candidate.practitionerId.length > 0 &&
    candidate.practitionerId.length <= 64 &&
    typeof candidate.displayName === 'string' &&
    candidate.displayName.length > 0 &&
    candidate.displayName.length <= 200
  );
};

const isActiveBedAssignment = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.encounterId === 'string' &&
    /^\d+$/.test(candidate.encounterId) &&
    typeof candidate.bedId === 'string' &&
    /^(?:R[1-4]|NEO[12]|H[1-6]C[12])$/.test(candidate.bedId)
  );
};

export const isRayenCensusSnapshot = (value: unknown): value is RayenCensusSnapshot => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.facilityId === 'number' &&
    typeof candidate.capturedAt === 'string' &&
    Array.isArray(candidate.encounters) &&
    candidate.encounters.every(isEncounter) &&
    (candidate.physicians === undefined ||
      (Array.isArray(candidate.physicians) &&
        candidate.physicians.length <= 500 &&
        candidate.physicians.every(isTreatingPhysician))) &&
    (candidate.activeBedAssignments === undefined ||
      (Array.isArray(candidate.activeBedAssignments) &&
        candidate.activeBedAssignments.length <= 30 &&
        candidate.activeBedAssignments.every(isActiveBedAssignment)))
  );
};

const isEgresoReportRow = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return [
    'run',
    'patientName',
    'bedLabel',
    'servicio',
    'edad',
    'destino',
    'motivo',
    'fechaEgreso',
  ].every(field => typeof candidate[field] === 'string');
};

export const isRayenSyncBundle = (value: unknown): value is RayenSyncBundle => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const fichaCapturedAt = Date.parse(String(candidate.fichaMedicoCapturedAt ?? ''));
  const gestionCapturedAt = Date.parse(String(candidate.gestionCamasCapturedAt ?? ''));
  const startedAt = Date.parse(String(candidate.startedAt ?? ''));
  const completedAt = Date.parse(String(candidate.completedAt ?? ''));
  const measuredSkew = Math.abs(fichaCapturedAt - gestionCapturedAt);
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.startedAt === 'string' &&
    typeof candidate.completedAt === 'string' &&
    typeof candidate.facilityId === 'number' &&
    typeof candidate.dateStart === 'string' &&
    typeof candidate.dateEnd === 'string' &&
    typeof candidate.fichaMedicoCapturedAt === 'string' &&
    typeof candidate.gestionCamasCapturedAt === 'string' &&
    typeof candidate.sourceSkewMs === 'number' &&
    Number.isFinite(candidate.sourceSkewMs) &&
    candidate.sourceSkewMs >= 0 &&
    candidate.sourceSkewMs <= MAX_SOURCE_SKEW_MS &&
    Number.isFinite(fichaCapturedAt) &&
    Number.isFinite(gestionCapturedAt) &&
    Number.isFinite(startedAt) &&
    Number.isFinite(completedAt) &&
    startedAt <= completedAt &&
    measuredSkew === candidate.sourceSkewMs &&
    Array.isArray(candidate.egresoRows) &&
    candidate.egresoRows.every(isEgresoReportRow)
  );
};

const isRayenImportMessage = (value: unknown): value is RayenImportMessage => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === RAYEN_IMPORT_MESSAGE_TYPE &&
    typeof candidate.requestId === 'string' &&
    candidate.requestId.length > 0 &&
    isRayenCensusSnapshot(candidate.snapshot) &&
    candidate.snapshot.isComplete === true &&
    isRayenSyncBundle(candidate.bundle) &&
    candidate.bundle.facilityId === candidate.snapshot.facilityId &&
    candidate.bundle.fichaMedicoCapturedAt === candidate.snapshot.capturedAt
  );
};

type SnapshotHandler = (snapshot: RayenCensusSnapshot, bundle: RayenSyncBundle) => void;
type ImportErrorHandler = (error: string) => void;

const handlers = new Set<SnapshotHandler>();
const errorHandlers = new Set<ImportErrorHandler>();
let windowListenerAttached = false;
let activeSyncRequestId: string | null = null;

const detachWindowListenerIfUnused = (): void => {
  if (
    handlers.size === 0 &&
    errorHandlers.size === 0 &&
    windowListenerAttached &&
    typeof window !== 'undefined'
  ) {
    window.removeEventListener('message', onWindowMessage);
    windowListenerAttached = false;
  }
};

const attachWindowListener = (): void => {
  if (!windowListenerAttached && typeof window !== 'undefined') {
    window.addEventListener('message', onWindowMessage);
    windowListenerAttached = true;
  }
};

const onWindowMessage = (event: MessageEvent): void => {
  if (typeof window !== 'undefined' && event.origin !== window.location.origin) return;
  if (
    typeof event.data === 'object' &&
    event.data !== null &&
    event.data.type === RAYEN_IMPORT_ERROR_MESSAGE_TYPE &&
    typeof event.data.error === 'string'
  ) {
    const requestId = typeof event.data.requestId === 'string' ? event.data.requestId : '';
    if (!requestId || requestId !== activeSyncRequestId) return;
    activeSyncRequestId = null;
    errorHandlers.forEach(handler => handler(event.data.error));
    return;
  }
  if (!isRayenImportMessage(event.data)) return;
  if (event.data.requestId !== activeSyncRequestId) return;
  activeSyncRequestId = null;
  handlers.forEach(handler => handler(event.data.snapshot, event.data.bundle));
};

export const subscribeToRayenSnapshots = (handler: SnapshotHandler): (() => void) => {
  handlers.add(handler);
  attachWindowListener();
  return () => {
    handlers.delete(handler);
    detachWindowListenerIfUnused();
  };
};

export const subscribeToRayenImportErrors = (handler: ImportErrorHandler): (() => void) => {
  errorHandlers.add(handler);
  attachWindowListener();
  return () => {
    errorHandlers.delete(handler);
    detachWindowListenerIfUnused();
  };
};

export const requestRayenSyncBundle = (dateStart: string, dateEnd: string): string => {
  const requestId = `rayen-sync-${crypto.randomUUID()}`;
  activeSyncRequestId = requestId;
  if (typeof window === 'undefined') return requestId;
  window.postMessage(
    { type: RAYEN_SYNC_BUNDLE_REQUEST_MESSAGE_TYPE, requestId, dateStart, dateEnd },
    window.location.origin
  );
  return requestId;
};

export const cancelRayenSyncBundleRequest = (requestId: string): void => {
  if (activeSyncRequestId === requestId) activeSyncRequestId = null;
};
