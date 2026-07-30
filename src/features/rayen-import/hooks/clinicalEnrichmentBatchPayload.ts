import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type {
  ClinicalFillBatchEvidence,
  ClinicalFillPatchOperation,
} from '../contracts/clinicalFillContracts';
import {
  RAYEN_CLINICAL_ENRICHMENT_FIELDS,
  RAYEN_CLINICAL_ENRICHMENT_MAX_BATCH_BYTES,
  type RayenClinicalCheckpointTarget,
  type RayenClinicalEnrichmentBatchPayload,
  type RayenClinicalEnrichmentTarget,
} from '../bridge/rayenClinicalEnrichmentBatchClient';
import type { ClinicalEnrichmentBatchMode } from '../domain/clinicalEnrichmentBatchMode';

const CHECKPOINT_FIELD = 'clinicalSyncCheckpoint';
const allowedFields = new Set<string>(RAYEN_CLINICAL_ENRICHMENT_FIELDS);

const serializedBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const targetKey = (target: { bedId: string; clinicalCrib?: true }): string =>
  `${target.bedId}|${target.clinicalCrib ? 'crib' : 'patient'}`;

const operationFields = (
  operation: ClinicalFillPatchOperation
): RayenClinicalEnrichmentTarget['fields'] => {
  const { target, patch } = operation;
  const prefix = `beds.${target.bedId}${target.clinicalCrib ? '.clinicalCrib' : ''}.`;
  const fields: RayenClinicalEnrichmentTarget['fields'] = {};

  Object.entries(patch).forEach(([path, value]) => {
    if (!path.startsWith(prefix)) {
      throw new Error('El lote clínico contiene una ruta fuera del paciente esperado.');
    }
    const field = path.slice(prefix.length);
    if (!allowedFields.has(field) || field.includes('.')) {
      throw new Error('El lote clínico contiene un campo no autorizado.');
    }
    fields[field as keyof typeof fields] = value === undefined ? null : value;
  });
  return fields;
};

const commonTarget = (operation: ClinicalFillPatchOperation) => ({
  bedId: operation.target.bedId,
  clinicalEpisodeId: operation.target.clinicalEpisodeId,
  ...(operation.target.clinicalCrib ? { clinicalCrib: true as const } : {}),
});

const splitOperation = (
  operation: ClinicalFillPatchOperation
): {
  patch?: RayenClinicalEnrichmentTarget;
  checkpoint?: RayenClinicalCheckpointTarget;
} => {
  const fields = operationFields(operation);
  const checkpointPresent = Object.prototype.hasOwnProperty.call(fields, CHECKPOINT_FIELD);
  const clinicalFields = Object.fromEntries(
    Object.entries(fields).filter(([field]) => field !== CHECKPOINT_FIELD)
  ) as RayenClinicalEnrichmentTarget['fields'];
  const hasClinicalChange =
    (operation.clinicalFieldCount ?? Object.keys(clinicalFields).length) > 0 &&
    Object.keys(clinicalFields).length > 0;

  return {
    ...(hasClinicalChange ? { patch: { ...commonTarget(operation), fields: clinicalFields } } : {}),
    ...(checkpointPresent
      ? {
          checkpoint: {
            ...commonTarget(operation),
            checkpoint: fields[CHECKPOINT_FIELD],
          },
        }
      : {}),
  };
};

export const summarizeClinicalEnrichmentSections = (
  patches: RayenClinicalEnrichmentTarget[],
  checkpoints: RayenClinicalCheckpointTarget[],
  mode: ClinicalFillBatchEvidence['mode'],
  parity: ClinicalFillBatchEvidence['parity'] = 'unavailable'
): ClinicalFillBatchEvidence => {
  const clinicalKeys = new Set(patches.map(targetKey));
  const checkpointKeys = new Set(checkpoints.map(targetKey));
  return {
    mode,
    parity,
    clinicalTargets: clinicalKeys.size,
    checkpointTargets: checkpointKeys.size,
    checkpointOnlyTargets: [...checkpointKeys].filter(key => !clinicalKeys.has(key)).length,
    requestedFields:
      patches.reduce((total, patch) => total + Object.keys(patch.fields).length, 0) +
      checkpoints.length,
  };
};

export const prepareClinicalEnrichmentBatchPayload = ({
  mode,
  record,
  runId,
  operations,
  mutationId,
}: {
  mode: ClinicalEnrichmentBatchMode;
  record: DailyRecord;
  runId: string;
  operations: ClinicalFillPatchOperation[];
  mutationId: string;
}): {
  payload: RayenClinicalEnrichmentBatchPayload | null;
  evidence: ClinicalFillBatchEvidence;
} => {
  const sections = operations.map(splitOperation);
  const patches = sections.flatMap(section => (section.patch ? [section.patch] : []));
  const checkpoints = sections.flatMap(section => (section.checkpoint ? [section.checkpoint] : []));
  const effectiveMode = mode === 'shadow' ? 'shadow' : 'enforced';
  const evidence = summarizeClinicalEnrichmentSections(patches, checkpoints, effectiveMode);
  const targetCount = new Set([...patches, ...checkpoints].map(targetKey)).size;
  const sectionsPayload = { patches, ...(checkpoints.length > 0 ? { checkpoints } : {}) };

  if (
    operations.length === 0 ||
    targetCount === 0 ||
    targetCount > 32 ||
    serializedBytes(sectionsPayload) > RAYEN_CLINICAL_ENRICHMENT_MAX_BATCH_BYTES
  ) {
    return { payload: null, evidence };
  }

  const revision = Number(
    (record as DailyRecord & { meta?: { revision?: unknown } }).meta?.revision
  );
  return {
    payload: {
      date: record.date,
      runId,
      mutationId,
      expectedLastUpdated: record.lastUpdated,
      ...(Number.isFinite(revision) && revision >= 0 ? { baseRevision: revision } : {}),
      mode: effectiveMode,
      dryRun: effectiveMode === 'shadow',
      ...sectionsPayload,
    },
    evidence,
  };
};
