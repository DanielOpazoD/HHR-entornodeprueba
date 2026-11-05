import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(path, 'utf8');

describe('laboratory loading boundaries', () => {
  it('uses the lightweight public entry for the census quick action', () => {
    expect(source('src/app-shell/runtime/AuthenticatedAppShell.tsx')).toContain(
      "import('@/features/laboratory/quick-action')"
    );
    expect(source('src/features/laboratory/quick-action.ts')).not.toContain(
      'LabResultsViewerModal'
    );
  });

  it('hands the clinical explorer its hospitalization hook outside the precached barrel', () => {
    // The explorer loads on demand and is not precached; through `public.ts` the hook would land
    // in the precached laboratory chunk instead (bundle budget, 2026-11-05).
    expect(
      source('src/features/census/components/clinical-explorer/ClinicalExplorerLab.tsx')
    ).toContain("from '@/features/laboratory/hospitalization-reports'");
    expect(source('src/features/laboratory/public.ts')).not.toContain(
      'useSyslabHospitalizationReports'
    );
  });

  it.each([
    ['LaboratoryQuickAction', 'LabResultsViewerModal'],
    ['LabResultsViewerModal', 'LabViewerAnalysis'],
    ['LabResultsViewerModal', 'LabViewerPdf'],
  ])('%s loads %s only through a dynamic boundary', (owner, component) => {
    const code = source(`src/features/laboratory/components/${owner}.tsx`);
    expect(code).not.toMatch(new RegExp(`import\\s+[^;]+from ['"]\\./${component}['"]`));
    expect(code).toContain(`import('./${component}')`);
  });
});
