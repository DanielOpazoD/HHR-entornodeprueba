/**
 * `meta.fieldWrites`: which edit wrote each field of the day. Only the server writes it, with
 * every patch, whole-day save and Rayen batch, naming only the fields that write changed:
 * - `fields[path]`: the day revision that last wrote the field and a digest of the value it
 *   stored (`digest` is null for `*`, a write of the whole day);
 * - `writes[revision]`: the edit (`mutationId`) and the computer (`clientId`) behind each
 *   revision a field still names;
 * - `revision`: the day revision this map was last brought up to date with, and `fenced` when that
 *   write ran under the Rayen clinical fence (the rules then keep clients out of `beds` and
 *   `bedTypeOverrides`: `preservesServerOwnedClinicalState`);
 * - `incompleteThrough`: the newest revision whose changes the map may miss. A writer that leaves
 *   the map as it was is found by the next write that keeps the map: a server write (a restore)
 *   left the map below the day's revision, or a direct client write left a `lastUpdated` that is
 *   not the stamp a server write puts in `meta.updatedAt`;
 * - `outsideBedsIncompleteThrough`: the same for a direct client write between two fenced writes,
 *   which can only have changed day fields outside the bed tree (handoff texts, staffing).
 * A queued edit replayed after a lost answer tells by it which fields its own earlier edit wrote
 * and which another computer wrote after the base it saw (src/services/storage/sync/
 * fieldWriteAttribution.ts reads it, with the same digest). An entry at or before the mark that
 * covers its path, or whose digest no longer matches the stored value, never credits a field.
 */
const MAX_FIELD_WRITES = 300;

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A stored value as one text: map keys sorted, an absent value as null, a timestamp by instant. */
const canonicalValue = value => {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (value instanceof Date) {
    const millis = value.getTime();
    return JSON.stringify(
      `@${Math.floor(millis / 1000)}.${(((millis % 1000) + 1000) % 1000) * 1e6}`
    );
  }
  if (typeof value === 'object' && typeof value.toMillis === 'function')
    return JSON.stringify(`@${value.seconds}.${value.nanoseconds}`);
  if (typeof value === 'object')
    return `{${Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalValue(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};

/** A 53-bit digest of the stored value (cyrb53), in base 36. Not a security measure. */
const fieldValueDigest = value => {
  const text = canonicalValue(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

const readValueAtPath = (record, path) =>
  String(path)
    .split('.')
    .reduce(
      (current, segment) =>
        current !== null && typeof current === 'object' ? current[segment] : undefined,
      record
    );

const isEntry = entry =>
  isPlainObject(entry) && Number.isSafeInteger(entry.revision) && entry.revision >= 0;

const revisionOf = value => (Number.isSafeInteger(value) && value >= 0 ? value : undefined);

/** A stored stamp as one comparable value: a timestamp to the nanosecond, or its text. */
const stampOf = value => {
  if (typeof value === 'string') return value;
  return value !== null && typeof value === 'object' && typeof value.toMillis === 'function'
    ? `${value.seconds}.${value.nanoseconds}`
    : undefined;
};

/** A map of fields to compare key by key; a timestamp or a date is one value. */
const isFieldMap = value =>
  isPlainObject(value) && !(value instanceof Date) && typeof value.toMillis !== 'function';

/**
 * The fields a whole-day write changes, as the shortest paths whose stored values differ (a list
 * is one value). The day's version fields (`meta`, `lastUpdated`) are not fields.
 */
const changedFieldPaths = (before, after, prefix = '') =>
  [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].flatMap(key => {
    if (!prefix && (key === 'meta' || key === 'lastUpdated')) return [];
    const path = prefix ? `${prefix}.${key}` : key;
    const left = before?.[key];
    const right = after?.[key];
    if (isFieldMap(left) && isFieldMap(right)) return changedFieldPaths(left, right, path);
    return canonicalValue(left) === canonicalValue(right) ? [] : [path];
  });

/**
 * The map after a write of `paths` (`*`: the whole day) that produced `revision` of `record` over
 * `previousDay`, the day as stored before it. A written path replaces its own entry and the
 * entries below it; an entry above it still names the rest of that object. Past
 * MAX_FIELD_WRITES the oldest entries go: a field without an entry is decided as before the map.
 */
const nextFieldWrites = ({
  previousDay,
  paths,
  record,
  revision,
  mutationId,
  clientId,
  fenced = false,
}) => {
  const written = paths.includes('*') ? ['*'] : [...new Set(paths)];
  const previous = isPlainObject(previousDay?.meta?.fieldWrites)
    ? previousDay.meta.fieldWrites
    : {};
  const before = isPlainObject(previous.fields) && !written.includes('*') ? previous.fields : {};
  const previousRevision = revisionOf(previousDay?.meta?.revision) ?? 0;
  const recorded = Object.keys(before).length > 0;
  const serverMissed = recorded && revisionOf(previous.revision) !== previousRevision;
  const clientMissed =
    recorded &&
    (!stampOf(previousDay?.lastUpdated) ||
      stampOf(previousDay?.lastUpdated) !== stampOf(previousDay?.meta?.updatedAt));
  const bedsFenced = fenced && previous.fenced === true;
  const incompleteThrough =
    serverMissed || (clientMissed && !bedsFenced)
      ? previousRevision
      : revisionOf(previous.incompleteThrough);
  const outsideBedsIncompleteThrough = clientMissed
    ? previousRevision
    : revisionOf(previous.outsideBedsIncompleteThrough);
  const kept = Object.entries(before)
    .filter(
      ([path, entry]) =>
        isEntry(entry) && !written.some(next => path === next || path.startsWith(`${next}.`))
    )
    .sort(([, left], [, right]) => right.revision - left.revision);
  const fields = Object.fromEntries(
    [
      ...written.map(path => [
        path,
        { revision, digest: path === '*' ? null : fieldValueDigest(readValueAtPath(record, path)) },
      ]),
      ...kept,
    ].slice(0, MAX_FIELD_WRITES)
  );
  const previousWrites = isPlainObject(previous.writes) ? previous.writes : {};
  const writes = Object.fromEntries(
    [...new Set(Object.values(fields).map(entry => String(entry.revision)))].map(key => [
      key,
      key === String(revision)
        ? { mutationId: mutationId || null, clientId: clientId || null }
        : previousWrites[key] || { mutationId: null, clientId: null },
    ])
  );
  return {
    revision,
    ...(fenced ? { fenced: true } : {}),
    fields,
    writes,
    ...(incompleteThrough === undefined ? {} : { incompleteThrough }),
    ...(outsideBedsIncompleteThrough === undefined ? {} : { outsideBedsIncompleteThrough }),
  };
};

/**
 * The map after a server write of the whole `record` whose meta names its revision: the fields it
 * changed from `previousDay`, `mutationId` (none: no edit of anyone's) and no computer.
 * `policySnapshot` is the Rayen import policy read in the same transaction.
 */
const wholeRecordFieldWrites = (record, previousDay, { mutationId = null, policySnapshot } = {}) =>
  nextFieldWrites({
    previousDay,
    paths: changedFieldPaths(previousDay, record),
    record,
    revision: record.meta.revision,
    mutationId,
    clientId: null,
    fenced: Boolean(policySnapshot?.exists) && policySnapshot.data()?.schemaVersion === 2,
  });

module.exports = {
  MAX_FIELD_WRITES,
  changedFieldPaths,
  fieldValueDigest,
  nextFieldWrites,
  wholeRecordFieldWrites,
};
