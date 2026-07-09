import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const projectPathExists = (relativePath: string): boolean =>
  existsSync(path.join(process.cwd(), relativePath));

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
});
