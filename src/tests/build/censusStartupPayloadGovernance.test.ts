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

  it('does not pretend the CIE-10 search works offline', () => {
    const budget = JSON.parse(read('scripts/config/bundle-budget.json'));
    // The catalogue itself is already outside precache; caching only its wrapper
    // would suggest an offline capability that does not exist.
    expect(budget.precacheIgnoredAssetPatterns).toEqual(
      expect.arrayContaining([
        '^assets/terminologyService-.*\\.js$',
        '^assets/DiagnosisCie10Cell-.*\\.js$',
      ])
    );
    expect(read('vite.config.ts')).toContain("'**/assets/DiagnosisCie10Cell-*.js'");
  });
});
