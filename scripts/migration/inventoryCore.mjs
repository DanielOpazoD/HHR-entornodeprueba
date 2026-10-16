import { createHash } from 'node:crypto';

export const CENSUS_FIELDS = ['date', 'beds', 'discharges', 'transfers', 'cma', 'bedTypeOverrides'];
export const INVENTORY_FIELDS = [...CENSUS_FIELDS, '_syncedAt', 'rayenSync', 'rayenSyncHistory'];
export const SOURCE_PROJECT = 'hhr-serviciohospitalizados';
export const TARGET_PROJECT = 'hhr-pruebas';
export const PROTECTED_MONTHS = ['2026-08', '2026-09'];

const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonical(value[key])])
    );
  return value;
};
export const inventoryDigest = value =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');

const text = value => (typeof value?.stringValue === 'string' ? value.stringValue : '');
const nonblank = value => Boolean(text(value).trim());
const map = value => value?.mapValue?.fields || {};
const array = value => value?.arrayValue?.values || [];
const occupied = fields => nonblank(fields.patientName) || nonblank(fields.rut);
const validDate = value =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

/** Raw Firestore values stay in memory. Reports expose only aggregate facts and whole-day hashes. */
export const censusDocuments = (documents, project) => {
  if (!Array.isArray(documents)) throw new Error('invalid_inventory_documents');
  const prefix = `projects/${project}/databases/(default)/documents/hospitals/hanga_roa/dailyRecords/`;
  const result = new Map();
  for (const document of documents) {
    if (!document?.name?.startsWith(prefix)) throw new Error('unexpected_inventory_document');
    const date = document.name.slice(prefix.length);
    if (
      !validDate(date) ||
      text(document.fields?.date) !== date ||
      result.has(date) ||
      !document.updateTime ||
      !Number.isFinite(Date.parse(document.updateTime))
    )
      throw new Error('invalid_inventory_document');
    result.set(date, document);
  }
  return result;
};

const summarizeDay = document => {
  const fields = document.fields || {};
  const beds = Object.values(map(fields.beds)).map(map);
  const patients = beds.filter(occupied);
  const cribs = beds.map(patient => map(patient.clinicalCrib)).filter(occupied);
  const movements = ['discharges', 'transfers', 'cma'].flatMap(key =>
    array(fields[key])
      .map(map)
      .filter(item => !nonblank(item.deletedAt))
  );
  const nursingFields = [
    ...patients,
    ...cribs,
    ...movements.map(item => map(item.originalData)),
  ].reduce(
    (count, patient) =>
      count +
      ['handoffNoteDayShift', 'handoffNoteNightShift'].filter(key => nonblank(patient[key])).length,
    0
  );
  const mirror = fields._syncedAt?.timestampValue || text(fields._syncedAt);
  const extension =
    Object.keys(map(fields.rayenSync)).length > 0 ||
    array(fields.rayenSyncHistory).some(item => Object.keys(map(item)).length > 0);
  return {
    occupiedBeds: patients.length,
    nestedCribs: cribs.length,
    movementOccurrences: movements.length,
    nursingTextFields: nursingFields,
    originHint:
      mirror && extension
        ? 'mixed'
        : mirror
          ? 'mirror_marker'
          : extension
            ? 'extension_trace'
            : 'unconfirmed',
    censusHash: inventoryDigest(
      Object.fromEntries(CENSUS_FIELDS.filter(key => key in fields).map(key => [key, fields[key]]))
    ),
    readVersion: document.updateTime,
  };
};

const versions = documents => [...documents].map(([date, document]) => [date, document.updateTime]);
const validOfficialMetadata = metadata =>
  metadata &&
  Object.keys(metadata).length === PROTECTED_MONTHS.length &&
  PROTECTED_MONTHS.every(
    month =>
      typeof metadata[month]?.version === 'string' &&
      metadata[month].version.trim() &&
      typeof metadata[month]?.updateTime === 'string' &&
      Number.isFinite(Date.parse(metadata[month].updateTime))
  );

export const buildMigrationInventory = ({
  source,
  target,
  sourceAfter,
  targetAfter,
  officialBefore,
  officialAfter,
  observedAt,
}) => {
  const a = censusDocuments(source, SOURCE_PROJECT),
    b = censusDocuments(target, TARGET_PROJECT);
  const aAfter = censusDocuments(sourceAfter, SOURCE_PROJECT),
    bAfter = censusDocuments(targetAfter, TARGET_PROJECT);
  const versionMap = records =>
    Object.fromEntries(versions(records).sort(([x], [y]) => x.localeCompare(y)));
  const stable =
    inventoryDigest([versionMap(a), versionMap(b)]) ===
    inventoryDigest([versionMap(aAfter), versionMap(bAfter)]);
  const officialUnchanged = Boolean(
    validOfficialMetadata(officialBefore) &&
    validOfficialMetadata(officialAfter) &&
    inventoryDigest(officialBefore) === inventoryDigest(officialAfter)
  );
  const days = [...new Set([...a.keys(), ...b.keys()])].sort().map(date => {
    const old = a.has(date) ? summarizeDay(a.get(date)) : null;
    const current = b.has(date) ? summarizeDay(b.get(date)) : null;
    return {
      date,
      source: old,
      target: current,
      comparison: !old
        ? 'target_only_preserved'
        : !current
          ? 'source_only_review'
          : old.censusHash === current.censusHash
            ? 'equal_stored_fields'
            : 'different_stored_fields',
    };
  });
  return {
    schemaVersion: 1,
    observedAt,
    sourceProject: SOURCE_PROJECT,
    targetProject: TARGET_PROJECT,
    sourceDays: a.size,
    targetDays: b.size,
    days,
    checks: { cloudWrites: 0, readWindowStable: stable, officialCudyrUnchanged: officialUnchanged },
    canUseForPlanning: stable && officialUnchanged,
    authorizesMigration: false,
    interpretation:
      'Stored-field differences are diagnostic, not missing-patient or eligibility decisions. Origin markers never authorize overwrite. Refresh before any bounded operation.',
  };
};
