import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(path, 'utf8');

const importStatements = (source: string): string[] =>
  source
    .split('\n')
    .filter(line => line.trim().startsWith('import '))
    .map(line => line.trim());

describe('hotspot public API governance', () => {
  it('keeps dailyRecordCoreContracts as a type-only application boundary', () => {
    const source = readSource('src/application/shared/dailyRecordCoreContracts.ts');

    expect(importStatements(source).every(line => line.startsWith('import type '))).toBe(true);
    expect(source).not.toMatch(/export\s+(const|function|class|interface)\s+/);
    expect(source).not.toContain('@/services/');
    expect(source).not.toContain('@/hooks/');
    expect(source).not.toContain('@/features/');
  });

  it('keeps patientRowContracts as a stable type barrel plus device callback contract', () => {
    const source = readSource('src/features/census/components/patient-row/patientRowContracts.ts');

    expect(importStatements(source).every(line => line.startsWith('import type '))).toBe(true);
    expect(source).not.toMatch(/export\s+(const|function|class)\s+/);
    expect(source).not.toContain('@/services/');
    expect(source).not.toContain('@/hooks/');
    expect(source).toMatch(/export interface PatientDeviceCallbacks/);
  });

  it('keeps applicationOutcomeTypes independent from feature and service layers', () => {
    const source = readSource('src/shared/contracts/applicationOutcomeTypes.ts');

    expect(importStatements(source)).toEqual([]);
    expect(source).not.toContain('@/services/');
    expect(source).not.toContain('@/hooks/');
    expect(source).not.toContain('@/features/');
    expect(source).toMatch(/export const isApplicationOutcomeSuccess/);
    expect(source).toMatch(/export const isApplicationOutcomeNonFailure/);
    expect(source).toMatch(/export const hasApplicationIssues/);
  });
});
