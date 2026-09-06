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
  'src/features/rayen-import/domain/censusDischargeHistory.ts',
  'src/domain/CensusManager.ts',
  'src/services/admin/admissionDateBackfillPlanner.ts',
  // Read-only historical audit: recover signed UPC evaluations from the patient
  // snapshot preserved in a completed movement, matched by patient and episode.
  'src/services/patient/patientUpcHistoryService.ts',
  // Read-only historical maintenance: discover attributed staff in completed
  // movement snapshots, without changing clinical records or mining free text.
  'src/services/staff/censusStaffDiscovery.ts',
  // Integrity scoring recognizes a newly persisted movement snapshot as evidence that a
  // vacated patient was preserved rather than erased during a multi-discharge sync.
  'src/utils/integrityGuard.ts',
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
