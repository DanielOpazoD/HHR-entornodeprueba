// @vitest-environment node
import { ONLINE_ONLY_PRECACHE_PATTERNS } from '../../../scripts/config/onlineOnlyAssets.mjs';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => fs.readFileSync(path, 'utf8');
const rowDir = 'src/features/census/components/patient-row';

describe('census startup payload', () => {
  it('keeps census diagnostic presentation outside the shared bootstrap policy module', () => {
    const bootstrap = read('src/hooks/controllers/dailyRecordBootstrapController.ts');
    expect(bootstrap).not.toContain('censusEmptyStateDiagnostic');
    expect(bootstrap).not.toContain('resolveCensusEmptyStateDiagnostic');
    expect(read('src/features/census/hooks/useCensusViewScreenModel.ts')).toContain(
      "from '@/features/census/controllers/censusEmptyStateDiagnostic'"
    );
  });

  it('keeps the CIE-10 catalogue out of the table cell that every row renders', () => {
    const cell = read(`${rowDir}/DiagnosisInput.tsx`);
    expect(cell).not.toContain('@/features/clinical-documents/services/terminologyService');
    expect(cell).not.toContain('TerminologySuggestor');
  });

  it('keeps the Rayen import machinery out of the census toolbar', () => {
    const header = read('src/features/census/components/CensusStaffHeader.tsx');
    expect(header).not.toMatch(/from\s+['"]@\/features\/rayen-import(?:\/RayenImportButton)?['"]/);
    expect(header).toMatch(
      /const RayenImportButton = lazyWithRetry\(\(\) =>\s*import\('@\/features\/rayen-import\/RayenImportButton'\)/
    );
    expect(header).not.toContain("import('@/features/rayen-import')");
    expect(read('src/features/rayen-import/RayenImportButton.ts')).toContain(
      "from './components/RayenImportButton'"
    );
    expect(read('src/features/rayen-import/RayenImportButton.ts')).not.toMatch(
      /from '\.\/index'|from '\.'/
    );
  });

  it('keeps clinical cells independent of synchronization status subscriptions', () => {
    for (const cell of ['VitalsCell', 'DevicesCell', 'ScoresCell']) {
      const source = read(`${rowDir}/${cell}.tsx`);
      expect(source).not.toContain('@/features/rayen-import');
      expect(source).not.toContain('useRayenFillStatus');
    }
  });

  it('reaches the light Rayen helpers through the narrow surface, not the feature barrel', () => {
    const consumers = [
      'StatisticalDischargeProvenanceBadge.tsx',
      'usePatientHospitalizationReports.ts',
      'eloisaAdmissionInput.ts',
    ].map(file => `src/features/census/components/${file}`);
    for (const file of consumers) {
      const source = read(file);
      expect(source).toContain('@/features/rayen-import/census-status');
      expect(source).not.toMatch(/from '@\/features\/rayen-import'/);
    }
    const table = read('src/features/census/components/CensusTable.tsx');
    expect(table).toContain('@/features/census/components/eloisaAdmissionInput');
    expect(table).not.toMatch(/from '@\/features\/rayen-import'/);
    // The narrow surface must stay narrow: re-exporting the barrel would undo the split.
    expect(read('src/features/rayen-import/census-status.ts')).not.toMatch(
      /from '\.\/index'|from '\.'/
    );
  });

  it('declares the narrow Rayen surfaces as public modules of the feature matrix', () => {
    const matrix = JSON.parse(read('scripts/feature-dependency-matrix.json'));
    expect(matrix.publicModulesByFeature['rayen-import']).toEqual(
      expect.arrayContaining([
        '@/features/rayen-import/RayenImportButton',
        '@/features/rayen-import/census-status',
        '@/features/rayen-import/clinical-panel',
      ])
    );
  });

  it('keeps patient-panel reads independent of census import through the governed API', () => {
    const consumers = [
      'ClinicalAntecedentCard.tsx',
      'ClinicalAntecedentContent.tsx',
      'ClinicalPanelAntecedents.tsx',
      'ClinicalPanelDrawer.tsx',
      'ClinicalPanelHistoryPrintButton.tsx',
      'ClinicalPanelPrescriptionButton.tsx',
      'ClinicalPanelProfessionTabs.tsx',
      'ClinicalPanelSections.tsx',
      'PatientDocumentManagerDialog.tsx',
      'RayenEncounterButton.tsx',
      'useClinicalPanelSnapshot.ts',
    ].map(file => `${rowDir}/${file}`);
    for (const file of consumers) {
      expect(read(file)).toContain('@/features/rayen-import/clinical-panel');
      expect(read(file)).not.toMatch(/from '@\/features\/rayen-import'/);
    }
    expect(read('src/features/rayen-import/clinical-panel.ts')).not.toMatch(
      /from '\.\/index'|from '\.'/
    );
    const drawer = read(`${rowDir}/ClinicalPanelDrawer.tsx`);
    expect(drawer).toContain("import('./ClinicalPanelAntecedents')");
    expect(drawer).not.toMatch(/import\s+\{\s*ClinicalPanelAntecedents\s*\}\s+from/);
  });

  it('does not pretend the CIE-10 search or the Rayen import work offline', () => {
    // The catalogue itself is already outside precache; caching only its wrapper
    // would suggest an offline capability that does not exist.
    expect(ONLINE_ONLY_PRECACHE_PATTERNS).toEqual(
      expect.arrayContaining([
        '^assets/terminologyService-.*\\.js$',
        '^assets/RayenImportButton-.*\\.js$',
      ])
    );
  });

  it('keeps extension handoff linking, table config JSON transfer, and manual Eloisa import lazy', () => {
    const shell = read('src/app-shell/runtime/AuthenticatedAppShell.tsx');
    expect(shell).not.toMatch(/import\s+\{\s*HandoffExtensionConnection\s*\}/);
    expect(shell).toContain("import('./HandoffExtensionConnection')");
    expect(shell).toContain('/conectar-entrega-turno');

    const tableConfigProvider = read('src/context/TableConfigProvider.tsx');
    expect(tableConfigProvider).not.toMatch(
      /import\s*\{[^}]*(?:exportTableConfig|importTableConfig)[^}]*\}\s*from\s*['"]@\/services\/storage\/tableConfigService['"]/
    );
    expect(tableConfigProvider).toContain("import('@/services/storage/tableConfigTransfer')");

    const table = read('src/features/census/components/CensusTable.tsx');
    expect(table).not.toMatch(
      /import\s+\{[^}]*\}\s+from\s+['"]@\/features\/rayen-manual-import['"]/
    );
    expect(table).not.toMatch(
      /import\s+\{[^}]*\}\s+from\s+['"]@\/features\/census\/components\/eloisaAdmissionInput['"]/
    );
    expect(table).toContain("import('@/features/rayen-manual-import')");
    expect(table).toContain("import('@/features/census/components/eloisaAdmissionInput')");

    const upcContext = read(`${rowDir}/UpcClassificationWindowContext.tsx`);
    expect(upcContext).not.toMatch(/import\s+\{[^}]*UpcClassificationWindow[^}]*\}\s+from/);
    expect(upcContext).toContain("import('./UpcClassificationWindow')");
  });
});
