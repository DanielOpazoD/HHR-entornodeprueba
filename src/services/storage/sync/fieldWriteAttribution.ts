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
 * The field writes a stored day tells: its `meta.fieldWrites`, and its last write as the meta names
 * it when the map does not record that write (a day saved before the map, or a writer that keeps
 * the map as it was). That last write stored the values the day holds now.
 */
export const storedFieldWrites = (remoteData: Record<string, unknown>): FieldWrite[] => {
  const meta = isRecord(remoteData.meta) ? remoteData.meta : {};
  const map = isRecord(meta.fieldWrites) ? meta.fieldWrites : {};
  const writes = isRecord(map.writes) ? map.writes : {};
  const recorded = Object.entries(isRecord(map.fields) ? map.fields : {}).flatMap(
    ([path, entry]): FieldWrite[] => {
      const revision = isRecord(entry) ? resolveOptionalBaseRevision(entry.revision) : undefined;
      if (!isRecord(entry) || revision === undefined) return [];
      const writer = writes[String(revision)];
      return [
        {
          path,
          revision,
          mutationId: isRecord(writer) ? textOf(writer.mutationId) : undefined,
          clientId: isRecord(writer) ? textOf(writer.clientId) : undefined,
          digest: textOf(entry.digest),
        },
      ];
    }
  );
  const revision = resolveOptionalBaseRevision(meta.revision);
  const named = Array.isArray(meta.lastChangedPaths) ? meta.lastChangedPaths : [];
  const lastWrite =
    revision === undefined
      ? []
      : named
          .filter(
            (path): path is string =>
              typeof path === 'string' &&
              path.trim().length > 0 &&
              !recorded.some(write => write.path === path && write.revision >= revision)
          )
          .map(path => ({
            path,
            revision,
            mutationId: textOf(meta.lastMutationId),
            clientId: textOf(meta.lastWriterClientId),
            digest: fieldValueDigest(getValueAtPath(remoteData, path)),
          }));
  return [...recorded, ...lastWrite];
};

const overlaps = (written: string, path: string): boolean =>
  written === '*' ||
  written === path ||
  written.startsWith(`${path}.`) ||
  path.startsWith(`${written}.`);

/**
 * Whether the newest write touching `path` is one of `ids` (this task's earlier edits), wrote
 * this very field and left the value it stored there.
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
    last.every(write => write.mutationId !== undefined && ids.includes(write.mutationId)) &&
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
