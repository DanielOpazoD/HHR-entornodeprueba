import {
  CLINICAL_SYNC_CHECKPOINT_VERSION,
  CLINICAL_SYNC_FINGERPRINT_VERSION,
  type ClinicalSyncCheckpoint,
  type ClinicalSyncFactCheckpoint,
  type ClinicalSyncSource,
  type ClinicalSyncSourceCheckpoint,
} from '@/types/domain/clinicalSync';

const MAX_CHECKPOINT_FACTS_PER_SOURCE = 128;

export interface ClinicalSourceFact {
  /** Stable source id when available. Falls back to the content fingerprint. */
  sourceId?: string | number | null;
  /** Non-identifying ordering key such as an event id or ISO timestamp. */
  watermark?: string | number | null;
  value: unknown;
}

export interface ClinicalIncrementalMetrics {
  received: number;
  newFacts: number;
  duplicates: number;
  corrections: number;
}

export const canonicalizeClinicalValue = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeClinicalValue).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeClinicalValue(item)}`)
    .join(',')}}`;
};

export const clinicalValuesEqual = (left: unknown, right: unknown): boolean =>
  canonicalizeClinicalValue(left) === canonicalizeClinicalValue(right);

/** Compact deterministic hash. It is an identity key, not a security primitive. */
const fingerprint = (value: unknown): string => {
  const input = canonicalizeClinicalValue(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v${CLINICAL_SYNC_FINGERPRINT_VERSION}-${(hash >>> 0).toString(36)}`;
};

const normalizeWatermark = (watermark: ClinicalSourceFact['watermark']): string =>
  watermark == null ? '' : String(watermark);

const toFactCheckpoint = (fact: ClinicalSourceFact): ClinicalSyncFactCheckpoint => {
  const valueFingerprint = fingerprint(fact.value);
  const watermark = normalizeWatermark(fact.watermark);
  return {
    identity: fingerprint(
      fact.sourceId != null && String(fact.sourceId).trim() !== ''
        ? { sourceId: String(fact.sourceId) }
        : { fallback: valueFingerprint }
    ),
    fingerprint: valueFingerprint,
    ...(watermark ? { watermark } : {}),
  };
};

const compareWatermarks = (left: string, right: string): number => {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (left !== '' && right !== '' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
};

const isCompatibleCheckpoint = (
  checkpoint: ClinicalSyncCheckpoint | undefined
): checkpoint is ClinicalSyncCheckpoint =>
  checkpoint?.version === CLINICAL_SYNC_CHECKPOINT_VERSION &&
  checkpoint.fingerprintVersion === CLINICAL_SYNC_FINGERPRINT_VERSION;

const sameSourceCheckpoint = (
  left: ClinicalSyncSourceCheckpoint | undefined,
  right: ClinicalSyncSourceCheckpoint
): boolean =>
  left?.watermark === right.watermark &&
  left?.lastFullValidationAt === right.lastFullValidationAt &&
  left?.lastFullValidationAttemptAt === right.lastFullValidationAttemptAt &&
  left?.facts.length === right.facts.length &&
  left.facts.every(
    (fact, index) =>
      fact.identity === right.facts[index]?.identity &&
      fact.fingerprint === right.facts[index]?.fingerprint
  );

export const mergeClinicalSourceCheckpoint = (
  checkpoint: ClinicalSyncCheckpoint | undefined,
  source: ClinicalSyncSource,
  facts: ClinicalSourceFact[],
  options: { fullValidationAt?: string; fullValidationAttemptAt?: string } = {}
): {
  checkpoint: ClinicalSyncCheckpoint;
  changed: boolean;
  metrics: ClinicalIncrementalMetrics;
} => {
  const compatible = isCompatibleCheckpoint(checkpoint);
  const previous = compatible ? checkpoint.sources[source] : undefined;
  const previousByIdentity = new Map(
    (previous?.facts ?? []).map(fact => [fact.identity, fact.fingerprint])
  );
  const current = facts.map(fact => ({
    checkpoint: toFactCheckpoint(fact),
    watermark: normalizeWatermark(fact.watermark),
  }));
  const uniqueByIdentity = new Map<string, (typeof current)[number]>();
  for (const item of current) {
    const previousItem = uniqueByIdentity.get(item.checkpoint.identity);
    if (!previousItem || compareWatermarks(item.watermark, previousItem.watermark) >= 0) {
      uniqueByIdentity.set(item.checkpoint.identity, item);
    }
  }
  const uniqueFacts = [...uniqueByIdentity.values()];
  const mergedFactsByIdentity = new Map(
    (previous?.facts ?? []).map(fact => [fact.identity, fact] as const)
  );
  for (const item of uniqueFacts) {
    mergedFactsByIdentity.set(item.checkpoint.identity, item.checkpoint);
  }
  const retainedFacts = [...mergedFactsByIdentity.values()]
    .sort(
      (left, right) =>
        compareWatermarks(right.watermark ?? '', left.watermark ?? '') ||
        right.identity.localeCompare(left.identity)
    )
    .slice(0, MAX_CHECKPOINT_FACTS_PER_SOURCE);
  const watermarks = current
    .map(item => item.watermark)
    .filter(Boolean)
    .sort((left, right) => compareWatermarks(right, left));
  const latestWatermark = [previous?.watermark ?? '', watermarks[0] ?? '']
    .filter(Boolean)
    .sort((left, right) => compareWatermarks(right, left))[0];
  const sourceCheckpoint: ClinicalSyncSourceCheckpoint = {
    ...(latestWatermark ? { watermark: latestWatermark } : {}),
    ...(options.fullValidationAt || previous?.lastFullValidationAt
      ? { lastFullValidationAt: options.fullValidationAt ?? previous?.lastFullValidationAt }
      : {}),
    ...(options.fullValidationAttemptAt || previous?.lastFullValidationAttemptAt
      ? {
          lastFullValidationAttemptAt:
            options.fullValidationAttemptAt ?? previous?.lastFullValidationAttemptAt,
        }
      : {}),
    facts: retainedFacts,
  };
  const metrics = uniqueFacts.reduce<ClinicalIncrementalMetrics>(
    (result, item) => {
      const previousFingerprint = previousByIdentity.get(item.checkpoint.identity);
      if (previousFingerprint == null) result.newFacts += 1;
      else if (previousFingerprint === item.checkpoint.fingerprint) result.duplicates += 1;
      else result.corrections += 1;
      return result;
    },
    {
      received: current.length,
      newFacts: 0,
      duplicates: current.length - uniqueFacts.length,
      corrections: 0,
    }
  );
  const changed = !compatible || !sameSourceCheckpoint(previous, sourceCheckpoint);
  if (!changed && checkpoint) return { checkpoint, changed: false, metrics };

  return {
    checkpoint: {
      version: CLINICAL_SYNC_CHECKPOINT_VERSION,
      fingerprintVersion: CLINICAL_SYNC_FINGERPRINT_VERSION,
      sources: {
        ...(compatible ? checkpoint.sources : {}),
        [source]: sourceCheckpoint,
      },
    },
    changed: true,
    metrics,
  };
};
