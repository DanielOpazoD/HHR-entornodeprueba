import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => fs.readFileSync(path, 'utf8');
const rowDir = 'src/features/census/components/patient-row';

describe('census startup payload', () => {
  it('keeps the CIE-10 catalogue out of the table cell that every row renders', () => {
    const cell = read(`${rowDir}/DiagnosisInput.tsx`);
    expect(cell).not.toContain('@/services/terminology/terminologyService');
    expect(cell).not.toContain('@/components/shared/TerminologySuggestor');
    expect(cell).toContain("React.lazy(() => import('./DiagnosisCie10Cell'))");
  });

  it('still resolves the stored description and the catalogue fallback in CIE-10 mode', () => {
    const lazyCell = read(`${rowDir}/DiagnosisCie10Cell.tsx`);
    expect(lazyCell).toContain('data.cie10Description');
    expect(lazyCell).toContain('getCIE10Description(data.cie10Code)');
    expect(lazyCell).toContain('TerminologySuggestor');
  });

  it('keeps the Rayen import machinery out of the census toolbar', () => {
    const header = read('src/features/census/components/CensusStaffHeader.tsx');
    expect(header).not.toContain("import { RayenImportButton } from '@/features/rayen-import'");
    expect(header).toContain("lazy(() =>\n  import('@/features/rayen-import/RayenImportButton')");
    expect(header).not.toContain("import('@/features/rayen-import')");
    expect(read('src/features/rayen-import/RayenImportButton.ts')).toContain(
      "from './components/RayenImportButton'"
    );
    expect(read('src/features/rayen-import/RayenImportButton.ts')).not.toMatch(
      /from '\.\/index'|from '\.'/
    );
    const file = 'src/features/census/components/CensusStaffHeader.tsx';
    const entry = '@/features/rayen-import/RayenImportButton';
    const publicApi = JSON.parse(read('scripts/feature-public-api-allowlist.json'));
    const dependencies = JSON.parse(read('scripts/feature-dependency-allowlist.json'));
    expect(publicApi.exceptionsByFeature['rayen-import']).toContain(`${file} -> ${entry}`);
    expect(dependencies.violations).toContain(
      `feature-must-use-public-api|${file}|${entry}|rayen-import`
    );
  });

  it('reaches the light Rayen helpers through the narrow surface, not the feature barrel', () => {
    const consumers = [
      'patient-row/VitalsCell.tsx',
      'patient-row/DevicesCell.tsx',
      'patient-row/ScoresCell.tsx',
      'StatisticalDischargeProvenanceBadge.tsx',
      'usePatientHospitalizationReports.ts',
    ].map(file => `src/features/census/components/${file}`);
    consumers.push('src/application/census/eloisaAdmissionInput.ts');
    for (const file of consumers) {
      const source = read(file);
      expect(source).toContain('@/features/rayen-import/census-status');
      expect(source).not.toMatch(/from '@\/features\/rayen-import'/);
    }
    const table = read('src/features/census/components/CensusTable.tsx');
    expect(table).toContain('@/application/census/eloisaAdmissionInput');
    expect(table).not.toMatch(/from '@\/features\/rayen-import'/);
    // The narrow surface must stay narrow: re-exporting the barrel would undo the split.
    expect(read('src/features/rayen-import/census-status.ts')).not.toMatch(
      /from '\.\/index'|from '\.'/
    );
  });

  it('declares the narrow surface in the governed boundary allowlists', () => {
    const publicApi = JSON.parse(read('scripts/feature-public-api-allowlist.json'));
    expect(publicApi.exceptionsByFeature['rayen-import']).toEqual(
      expect.arrayContaining([
        'src/features/census/components/patient-row/VitalsCell.tsx -> @/features/rayen-import/census-status',
        'src/application/census/eloisaAdmissionInput.ts -> @/features/rayen-import/census-status',
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
      'clinicalAntecedentEntries.ts',
      'useClinicalPanelSnapshot.ts',
    ].map(file => `${rowDir}/${file}`);
    const publicApi = JSON.parse(read('scripts/feature-public-api-allowlist.json'));
    const dependencies = JSON.parse(read('scripts/feature-dependency-allowlist.json'));
    for (const file of consumers) {
      expect(read(file)).toContain('@/features/rayen-import/clinical-panel');
      expect(read(file)).not.toMatch(/from '@\/features\/rayen-import'/);
      expect(publicApi.exceptionsByFeature['rayen-import']).toContain(
        `${file} -> @/features/rayen-import/clinical-panel`
      );
      expect(dependencies.violations).toContain(
        `feature-must-use-public-api|${file}|@/features/rayen-import/clinical-panel|rayen-import`
      );
    }
    expect(read('src/features/rayen-import/clinical-panel.ts')).not.toMatch(
      /from '\.\/index'|from '\.'/
    );
    const drawer = read(`${rowDir}/ClinicalPanelDrawer.tsx`);
    expect(drawer).toContain("import('./ClinicalPanelAntecedents')");
    expect(drawer).not.toMatch(/import\s+\{\s*ClinicalPanelAntecedents\s*\}\s+from/);
  });

  it('keeps configuration independent of the import workflow and preserves offline budgets', () => {
    const file = 'src/features/admin/components/ConfigurationView.tsx';
    const entry = '@/features/rayen-import/configuration';
    expect(read(file)).toContain(entry);
    expect(read(file)).not.toMatch(/from '@\/features\/rayen-import'/);
    expect(read('src/features/rayen-import/configuration.ts')).toContain(
      "from './components/RayenImportModeSetting'"
    );
    expect(read('src/features/rayen-import/configuration.ts')).not.toMatch(
      /from '\.\/index'|from '\.'/
    );
    const publicApi = JSON.parse(read('scripts/feature-public-api-allowlist.json'));
    const dependencies = JSON.parse(read('scripts/feature-dependency-allowlist.json'));
    expect(publicApi.exceptionsByFeature['rayen-import']).toContain(`${file} -> ${entry}`);
    expect(dependencies.violations).toContain(
      `feature-must-use-public-api|${file}|${entry}|rayen-import`
    );
    const budget = JSON.parse(read('scripts/config/bundle-budget.json'));
    expect(budget.precacheIgnoredAssetPatterns.join('\n')).not.toContain('RayenImportModeSetting');
    expect(read('vite.config.ts')).not.toContain('**/assets/RayenImportModeSetting-*.js');
  });

  it('does not pretend the CIE-10 search or the Rayen import work offline', () => {
    const budget = JSON.parse(read('scripts/config/bundle-budget.json'));
    // The catalogue itself is already outside precache; caching only its wrapper
    // would suggest an offline capability that does not exist.
    expect(budget.precacheIgnoredAssetPatterns).toEqual(
      expect.arrayContaining([
        '^assets/terminologyService-.*\\.js$',
        '^assets/DiagnosisCie10Cell-.*\\.js$',
        '^assets/RayenImportButton-.*\\.js$',
      ])
    );
    expect(read('vite.config.ts')).toContain("'**/assets/DiagnosisCie10Cell-*.js'");
  });
});
