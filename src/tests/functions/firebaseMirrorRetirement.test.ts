// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const projectPathExists = (relativePath: string): boolean =>
  existsSync(path.join(process.cwd(), relativePath));

const functionSources = (): string[] => [
  readProjectFile('functions/index.js'),
  ...readdirSync(path.join(process.cwd(), 'functions/lib'), { recursive: true, encoding: 'utf8' })
    .filter(file => /\.c?js$/.test(file))
    .map(file => readProjectFile(path.join('functions/lib', file))),
];

const retiredFunctionNames = (): string[] => {
  const workflow = readProjectFile('.github/workflows/deploy-functions.yml');
  const list = workflow.match(/RETIRED_FUNCTIONS=\(([^)]*)\)/)?.[1] ?? '';
  return list.split(/\s+/).filter(Boolean);
};

describe('firebase mirror retirement', () => {
  it('does not deploy official-to-testing Firestore mirror functions', () => {
    const functionsIndex = readProjectFile('functions/index.js');
    const appContext = readProjectFile('functions/lib/appContext.js');

    expect(functionsIndex).not.toContain('createMirrorFunctions');
    expect(functionsIndex).not.toMatch(
      /mirror(?:DailyRecords|AuditLogs|Settings|TransferRequests|ClinicalDocuments)/
    );
    expect(appContext).not.toContain('createMirrorSecondaryFirestore');
    expect(appContext).not.toContain('dbBeta');
    expect(projectPathExists('functions/lib/mirror')).toBe(false);
    expect(projectPathExists('functions/lib/mirrorFunctions.js')).toBe(false);
  });

  it('deletes the old medical handoff callables on deploy and no longer defines them', () => {
    const retired = retiredFunctionNames();
    expect(retired).toEqual(
      expect.arrayContaining([
        'updateSpecialistMedicalHandoff',
        'getMedicalHandoffSignaturePayload',
        'submitMedicalHandoffSignature',
      ])
    );
    // A retired name that is still defined would be deleted and then deployed again.
    const sources = functionSources();
    for (const name of retired) {
      expect(
        sources.some(source => new RegExp(`\\b${name}\\b`).test(source)),
        name
      ).toBe(false);
    }
  });
});
