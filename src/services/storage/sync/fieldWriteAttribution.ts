import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';
import { resolveOptionalBaseRevision } from './syncTaskContractPolicy';

/**
 * Which edit wrote each field of a stored day, as the server records it in `meta.fieldWrites`
 * (functions/lib/dailyRecordFieldWrites.js, the same digest): the replay of a queued edit tells by
 * it its own earlier writes from another computer's.
 */
export interface FieldWrite {
  path: string;
  revision: number;
  mutationId?: string;
  clientId?: string;
  /** Digest of the value that write stored (none for `*`, the whole day). */
  digest?: string;
  /**
   * Whether this entry can credit a field to its edit: no change the map may miss came after it.
   * The map is at the day's revision and the entry is newer than `incompleteThrough`; outside the
   * bed tree, the day's last write was also a server write (it stamps `meta.updatedAt` with the
   * day's `lastUpdated`) and the entry is newer than `outsideBedsIncompleteThrough`. A direct
   * client write moves only the day's time and never reaches the bed tree (the fence).
   */
  credible: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

/** A stored value as one text: map keys sorted, an absent value as null, a timestamp by instant. */
const canonicalValue = (value: unknown): string => {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (value instanceof Date) {
    const millis = value.getTime();
    return JSON.stringify(
      `@${Math.floor(millis / 1000)}.${(((millis % 1000) + 1000) % 1000) * 1e6}`
    );
  }
  if (isRecord(value) && typeof value.toMillis === 'function')
    return JSON.stringify(`@${String(value.seconds)}.${String(value.nanoseconds)}`);
  if (isRecord(value))
    return `{${Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalValue(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};

/** A 53-bit digest of the stored value (cyrb53), in base 36. Not a security measure. */
export const fieldValueDigest = (value: unknown): string => {
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

/**
 * A field of the bed tree. Under the Rayen fence the rules keep clients from changing it
 * (`preservesServerOwnedClinicalState`), so a direct client write never reaches it.
 */
const isBedTreePath = (path: string): boolean => /^(beds|bedTypeOverrides)(\.|$)/.test(path);

/** A stored stamp as one comparable value: a Firestore timestamp to the nanosecond, or its text. */
const stampOf = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  const { seconds, nanoseconds } = (value ?? {}) as { seconds?: unknown; nanoseconds?: unknown };
  return typeof seconds === 'number' && typeof nanoseconds === 'number'
    ? `${seconds}.${nanoseconds}`
    : undefined;
};

/**
 * The field writes a stored day tells: its `meta.fieldWrites`, and, when the map is not at the
 * day's revision (a day saved before the map, or a writer that leaves it as it was), the last
 * write as the meta names it. That last write stored the values the day holds now; an edit
 * identifier the map gives to an earlier revision was inherited by it, not written.
 */
export const storedFieldWrites = (remoteData: Record<string, unknown>): FieldWrite[] => {
  const meta = isRecord(remoteData.meta) ? remoteData.meta : {};
  const map = isRecord(meta.fieldWrites) ? meta.fieldWrites : {};
  const writes = isRecord(map.writes) ? map.writes : {};
  const revision = resolveOptionalBaseRevision(meta.revision);
  const stamp = stampOf(remoteData.lastUpdated);
  const serverStamped = stamp !== undefined && stamp === stampOf(meta.updatedAt);
  const current = revision !== undefined && resolveOptionalBaseRevision(map.revision) === revision;
  const incompleteThrough = resolveOptionalBaseRevision(map.incompleteThrough) ?? -1;
  const outsideBedsIncompleteThrough =
    resolveOptionalBaseRevision(map.outsideBedsIncompleteThrough) ?? -1;
  const recorded = Object.entries(isRecord(map.fields) ? map.fields : {}).flatMap(
    ([path, entry]): FieldWrite[] => {
      const written = isRecord(entry) ? resolveOptionalBaseRevision(entry.revision) : undefined;
      if (!isRecord(entry) || written === undefined) return [];
      const writer = writes[String(written)];
      return [
        {
          path,
          revision: written,
          mutationId: isRecord(writer) ? textOf(writer.mutationId) : undefined,
          clientId: isRecord(writer) ? textOf(writer.clientId) : undefined,
          digest: textOf(entry.digest),
          credible:
            current &&
            written > incompleteThrough &&
            (isBedTreePath(path) || (serverStamped && written > outsideBedsIncompleteThrough)),
        },
      ];
    }
  );
  if (current || revision === undefined) return recorded;
  const lastMutationId = textOf(meta.lastMutationId);
  const inherited = Object.entries(writes).some(
    ([written, writer]) =>
      written !== String(revision) && isRecord(writer) && writer.mutationId === lastMutationId
  );
  const named = Array.isArray(meta.lastChangedPaths) ? meta.lastChangedPaths : [];
  const lastWrite = named
    .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    .map(path => ({
      path,
      revision,
      mutationId: inherited ? undefined : lastMutationId,
      clientId: textOf(meta.lastWriterClientId),
      digest: fieldValueDigest(getValueAtPath(remoteData, path)),
      credible: serverStamped || isBedTreePath(path),
    }));
  return [...recorded, ...lastWrite];
};

const overlaps = (written: string, path: string): boolean =>
  written === '*' ||
  written === path ||
  written.startsWith(`${path}.`) ||
  path.startsWith(`${written}.`);

/**
 * Whether the newest write touching `path` is one of `ids` (this task's earlier edits), credible,
 * wrote this very field and left the value it stored there. Otherwise the field is decided by its
 * values, as before the map.
 */
export const isLastWrittenBy = (
  writes: FieldWrite[],
  path: string,
  ids: string[],
  remoteData: Record<string, unknown>
): boolean => {
  const touching = writes.filter(write => overlaps(write.path, path));
  const newest = Math.max(-1, ...touching.map(write => write.revision));
  const last = touching.filter(write => write.revision === newest);
  return (
    last.length > 0 &&
    last.every(
      write => write.credible && write.mutationId !== undefined && ids.includes(write.mutationId)
    ) &&
    last.some(
      write =>
        write.path === path && write.digest === fieldValueDigest(getValueAtPath(remoteData, path))
    )
  );
};

/**
 * Whether another computer wrote `path` or a field below it after revision `seen`: a write that
 * is none of `ids` (this task's edits) nor of `clientId` (this computer, whose own writes its
 * census already shows). A write naming a whole bed or day (`beds.R1`, `*`) does not say it
 * wrote the field.
 */
export const isWrittenElsewhereSince = (
  writes: FieldWrite[],
  path: string,
  seen: number,
  ids: string[],
  clientId: string | undefined
): boolean =>
  writes.some(
    write =>
      (write.path === path || write.path.startsWith(`${path}.`)) &&
      write.revision > seen &&
      !(write.mutationId !== undefined && ids.includes(write.mutationId)) &&
      !(clientId !== undefined && write.clientId === clientId)
  );
