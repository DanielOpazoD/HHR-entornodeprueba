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

  it.each([
    ['LaboratoryQuickAction', 'LabResultsViewerModal'],
    ['LabResultsViewerModal', 'LabViewerAnalysis'],
    ['LabResultsViewerModal', 'LabViewerPdf'],
  ])('%s loads %s only through a dynamic boundary', (owner, component) => {
    const code = source(`src/features/laboratory/components/${owner}.tsx`);
    expect(code).not.toMatch(new RegExp(`import\\s+[^;]+from ['\"]\\./${component}['\"]`));
    expect(code).toContain(`import('./${component}')`);
  });
});
