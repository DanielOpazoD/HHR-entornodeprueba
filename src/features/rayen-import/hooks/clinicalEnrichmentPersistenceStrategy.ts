import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type {
  ClinicalFillPatchOperation,
  ClinicalFillPersistenceStrategy,
} from '../contracts/clinicalFillContracts';
import type { ClinicalEnrichmentBatchMode } from '../domain/clinicalEnrichmentBatchMode';
import {
  applyClinicalEnrichmentBatch,
  observeClinicalEnrichmentBatch,
} from './applyClinicalEnrichmentBatch';
import { rebuildClinicalEnrichmentOperations } from '../domain/rebuildClinicalEnrichmentOperations';
import {
  classifyRayenSyncError,
  reportRayenSyncWarning,
} from '../observability/rayenSyncDiagnostics';

interface CreateClinicalEnrichmentPersistenceStrategyInput {
  mode: ClinicalEnrichmentBatchMode;
  record: DailyRecord;
  runId: string;
  applyPatch: (operation: ClinicalFillPatchOperation) => Promise<void>;
  refreshRecord: () => Promise<DailyRecord>;
  applyBatch?: typeof applyClinicalEnrichmentBatch;
  observeBatch?: typeof observeClinicalEnrichmentBatch;
  rebuildOperations?: typeof rebuildClinicalEnrichmentOperations;
}

const recordRevision = (record: DailyRecord): unknown =>
  (record as DailyRecord & { meta?: { revision?: unknown } }).meta?.revision;

const sameAuthorityVersion = (left: DailyRecord, right: DailyRecord): boolean =>
  left.lastUpdated === right.lastUpdated && recordRevision(left) === recordRevision(right);

/** Selects one persistence owner once, before the clinical fill starts. */
export const createClinicalEnrichmentPersistenceStrategy = ({
  mode,
  record,
  runId,
  applyPatch,
  refreshRecord,
  applyBatch = applyClinicalEnrichmentBatch,
  observeBatch = observeClinicalEnrichmentBatch,
  rebuildOperations = rebuildClinicalEnrichmentOperations,
}: CreateClinicalEnrichmentPersistenceStrategyInput): ClinicalFillPersistenceStrategy => {
  if (mode === 'off') {
    return {
      disposition: 'immediate',
      persist: async () => undefined,
    };
  }

  if (mode === 'shadow') {
    return {
      disposition: 'observe',
      persist: async operations =>
        observeBatch({
          record: await refreshRecord(),
          runId,
          operations,
        }),
    };
  }

  return {
    disposition: 'deferred',
    persist: async operations => {
      // The clinical reads take several seconds, and the structural stage may have finished with
      // a metadata checkpoint that bumped the authority version after this record was handed
      // over. Sending that stale version guaranteed one rejected callable plus a full retry
      // (observed as ~19% "errors" in telemetry). Re-read once, cheaply, and rebase upfront.
      let baseRecord = record;
      let baseOperations = operations;
      try {
        const currentRecord = await refreshRecord();
        if (!sameAuthorityVersion(currentRecord, record)) {
          baseOperations = rebuildOperations({ baseRecord: record, currentRecord, operations });
          baseRecord = currentRecord;
          reportRayenSyncWarning('clinical_batch_base_rebased', {
            runId,
            patientCount: baseOperations.length,
          });
        }
      } catch (error) {
        reportRayenSyncWarning('clinical_batch_base_refresh_failed', {
          runId,
          errorKind: classifyRayenSyncError(error),
        });
      }
      return applyBatch({
        mode,
        record: baseRecord,
        runId,
        operations: baseOperations,
        rebuildOperations: currentRecord =>
          rebuildOperations({
            baseRecord: record,
            currentRecord,
            operations,
          }),
        applyPatch,
        refreshRecord,
      });
    },
  };
};
