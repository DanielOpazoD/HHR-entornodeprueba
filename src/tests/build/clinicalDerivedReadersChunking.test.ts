// @vitest-environment node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

// docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md: the overlay, the read service and the
// reader load on demand. A static import from these readers would ship them with every census.
const STATIC_READ_PATH =
  /from ['"][^'"]*(?:dailyRecordClinicalDerivedReadService|clinicalDerivedContract|clinicalDerivedEpisodeReader)['"]/;

describe('clinicalDerived readers chunking', () => {
  it.each([
    [
      'src/features/rayen-import/hooks/clinicalFillDerivedView.ts',
      "import('@/services/repositories/dailyRecordClinicalDerivedReadService')",
    ],
    [
      'src/features/census/components/patient-row/useClinicalDerivedVitalsHistory.ts',
      "import('@/services/repositories/dailyRecordClinicalDerivedReadService')",
    ],
    [
      'src/services/repositories/clinicalDayCarryover.ts',
      "import('./dailyRecordClinicalDerivedReadService')",
    ],
    [
      'src/services/staff/recoverCensusStaff.ts',
      "import('@/services/repositories/dailyRecordClinicalDerivedReadService')",
    ],
    [
      'src/services/exporters/clinicalDerivedBackupSection.ts',
      "import('@/services/repositories/dailyRecordClinicalDerivedReadService')",
    ],
  ])('%s loads the read path dynamically', (sourcePath, dynamicImport) => {
    const source = readSource(sourcePath);
    expect(source).not.toMatch(STATIC_READ_PATH);
    expect(source).toContain(dynamicImport);
  });

  it.each([
    'src/features/census/components/CensusTable.tsx',
    'src/features/census/components/patient-row/PatientInputCellSections.tsx',
    'src/features/census/components/patient-row/VitalsCell.tsx',
    'src/features/census/components/patient-row/clinicalDerivedDayContext.ts',
    'src/features/rayen-import/hooks/useRayenClinicalFill.ts',
    'src/features/rayen-import/hooks/patchFreshClinicalRecord.ts',
    'src/services/repositories/dailyRecordRepositoryInitializationService.ts',
    'src/services/exporters/exportService.ts',
    'src/services/admin/dataMaintenanceService.ts',
  ])('%s never imports the read path statically', sourcePath => {
    const source = readSource(sourcePath);
    expect(source).not.toMatch(STATIC_READ_PATH);
  });
});
