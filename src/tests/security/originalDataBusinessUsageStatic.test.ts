import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../');

const ALLOWED_ORIGINAL_DATA_REFERENCES = [
  'src/schemas/zod/movements.ts',
  'src/types/domain/movements.ts',
  'src/application/census/cmaEpisodeMovementFields.ts',
  'src/application/census/cmaUndoPatchUseCase.ts',
  'src/application/census/movementReclassificationBuilders.ts',
  'src/hooks/usePatientMovementUndoExecutor.ts',
  'src/hooks/controllers/censusExcelSheetController.ts',
  // Transport only: the census email request drops the clinical-sync derived fields from the
  // preserved snapshots before upload. The workbook never reads them; values are not interpreted.
  'src/services/integrations/censusEmailRequestPayload.ts',
  'src/features/census/controllers/patientMovementDischargeMutationController.ts',
  'src/features/census/controllers/movementClinicalDocumentsController.ts',
  'src/features/census/controllers/patientMovementTransferMutationController.ts',
  'src/features/census/controllers/patientMovementSelectionController.ts',
  'src/features/census/controllers/patientMovementUndoController.ts',
  'src/features/census/controllers/censusCmaController.ts',
  // Rayen census import builds discharge/transfer movements that carry the pre-movement
  // patient snapshot in originalData for the undo/audit machinery, same as the movement
  // controllers above. Its recorded-outcome matcher also reads that snapshot only as a
  // legacy fallback when an older movement lacks clinicalEpisodeId.
  'src/features/rayen-import/domain/applyCensusImportDiff.ts',
  'src/features/rayen-import/domain/associatedClinicalCribDischarge.ts',
  'src/features/rayen-import/domain/censusDischargeHistory.ts',
  // Capture ownership: legacy movements may preserve the episode ID only in their snapshot.
  // This read discovers an archive target; the server revalidates it against the census.
  'src/features/rayen-import/domain/cudyrCapturePlan.ts',
  // Read-only documentary attribution: preserved movement/crib identities can disprove a
  // unique episode. They never supply CUDYR values, current occupancy or a write target.
  'src/domain/evaluationScales/documentaryCudyr.ts',
  // Continuity D-1 reads the preserved pre-discharge identity only to prove that an
  // episode missing from today's census already has an explicit clinical outcome.
  'src/features/rayen-import/domain/previousCensusContinuity.ts',
  // Historical report identity: use the preserved exact episode and parental identifier only
  // as lookup targets. The individual source report must independently verify the outcome.
  'src/features/rayen-import/domain/previousCensusEgresoCandidates.ts',
  // Legacy movement classification: the preserved Cuna/Cama mode disambiguates old bed labels.
  // It never supplies current occupancy; explicit Cama and normal statistical rules prevail.
  'src/application/census/movementTombstonePolicy.ts',
  'src/domain/CensusManager.ts',
  'src/services/admin/admissionDateBackfillPlanner.ts',
  // Read-only historical audit: recover signed UPC evaluations from the patient
  // snapshot preserved in a completed movement, matched by patient and episode.
  'src/services/patient/patientUpcHistoryService.ts',
  // Read-only CUDYR audit of completed movements; reject snapshots of another episode.
  // This retained context is never evidence of continuing hospitalization.
  'src/services/cudyr/cudyrReportFacts.ts',
  // Read-only historical maintenance: discover attributed staff in completed
  // movement snapshots, without changing clinical records or mining free text.
  'src/services/staff/censusStaffDiscovery.ts',
  // Integrity scoring recognizes a newly persisted movement snapshot as evidence that a
  // vacated patient was preserved rather than erased during a multi-discharge sync.
  'src/utils/integrityGuard.ts',
  // Measurement only: daily-record size telemetry counts the bytes of the clinical-sync derived
  // fields inside preserved snapshots. No value is read for meaning or leaves the device.
  'src/services/storage/firestore/dailyRecordSizeTelemetry.ts',
  // Historical maintenance: a JSON backup restore puts each split episode's vitals history and
  // Rayen checkpoint back into the snapshot of its live discharge, transfer or CMA, matched by
  // the episode id that only that snapshot carries. Nothing else in the snapshot is read.
  'src/services/exporters/clinicalDerivedBackupRestore.ts',
  'src/types/virtual-minsal-shared.d.ts',
];

describe('originalData business governance', () => {
  it('limits originalData usage to undo, audit, compatibility and historical maintenance surfaces', () => {
    const command =
      'grep -rl "originalData" src --include="*.ts" --include="*.tsx" | grep -v "src/tests/" | grep -v "\\.md$"';
    const rawOutput = execSync(command, { cwd: ROOT, encoding: 'utf8' });
    const referencedFiles = rawOutput
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .sort();

    expect(referencedFiles).toEqual(ALLOWED_ORIGINAL_DATA_REFERENCES.sort());
  });
});
