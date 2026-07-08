import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (relativePath: string): string => {
  const absolutePath = path.resolve(__dirname, '../../../', relativePath);
  return fs.readFileSync(absolutePath, 'utf8');
};

const fileExists = (relativePath: string): boolean => {
  const absolutePath = path.resolve(__dirname, '../../../', relativePath);
  return fs.existsSync(absolutePath);
};

describe('prescription cleanup scheduler governance', () => {
  it('does not deploy an automatic prescription cleanup function', () => {
    const functionsIndex = readProjectFile('functions/index.js');

    expect(functionsIndex).not.toContain('createPrescriptionCleanupFunctions');
    expect(functionsIndex).not.toContain('cleanExpiredPrescriptions');
    expect(fileExists('functions/lib/prescriptionCleanupFunctions.js')).toBe(false);
  });

  it('documents manual admin deletion instead of a Cloud Scheduler prescription job', () => {
    const deployWorkflow = readProjectFile('.github/workflows/deploy-functions.yml');

    expect(deployWorkflow).not.toContain('cleanExpiredPrescriptions');
    expect(deployWorkflow).not.toContain('roles/cloudscheduler.admin');
  });
});
