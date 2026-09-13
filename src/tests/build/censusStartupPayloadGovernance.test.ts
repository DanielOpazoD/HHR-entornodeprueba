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
    expect(header).toContain("lazy(() =>\n  import('@/features/rayen-import')");
  });

  it('reaches the light Rayen helpers through the narrow surface, not the feature barrel', () => {
    const consumers = [
      'patient-row/VitalsCell.tsx',
      'patient-row/DevicesCell.tsx',
      'patient-row/ScoresCell.tsx',
      'CensusTable.tsx',
      'StatisticalDischargeProvenanceBadge.tsx',
      'usePatientHospitalizationReports.ts',
    ];
    for (const file of consumers) {
      const source = read(`src/features/census/components/${file}`);
      expect(source).toContain('@/features/rayen-import/census-status');
      expect(source).not.toMatch(/from '@\/features\/rayen-import'/);
    }
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
      ])
    );
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
