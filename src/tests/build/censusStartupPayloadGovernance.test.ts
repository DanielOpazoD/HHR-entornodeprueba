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

  it('imports the light Rayen helpers directly instead of through the feature barrel', () => {
    for (const file of [
      'patient-row/VitalsCell.tsx',
      'patient-row/DevicesCell.tsx',
      'patient-row/ScoresCell.tsx',
    ]) {
      expect(read(`src/features/census/components/${file}`)).toContain(
        '@/features/rayen-import/hooks/useRayenFillStatus'
      );
    }
    expect(read('src/features/census/components/CensusTable.tsx')).not.toContain(
      "from '@/features/rayen-import'"
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
