import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('firebase testing project isolation', () => {
  it('deploys Firebase Functions only to the old testing Firebase project', () => {
    const deployWorkflow = readProjectFile('.github/workflows/deploy-functions.yml');

    expect(deployWorkflow).toContain('--project hhr-pruebas');
    expect(deployWorkflow).not.toContain('--project hhr-serviciohospitalizados');
    expect(deployWorkflow).toContain('functions:delete');
    expect(deployWorkflow).toContain('mirrorDailyRecords');
    expect(deployWorkflow).toContain('mirrorClinicalDocuments');
  });
});
