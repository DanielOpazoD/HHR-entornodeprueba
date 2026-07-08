/**
 * Static drift guard between the prescription constants declared in TS
 * (`src/types/prescriptionTypes.ts`) and the parallel constants used by
 * the Cloud Functions (`functions/lib/prescriptionAccessFunctions.js`).
 *
 * The two layers can't share a module (Node CommonJS in functions/ vs
 * TS aliases in src/), so we accept the duplication and pin the values
 * here. If anyone changes one side without the other, this test fires
 * before the bug ships.
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

import {
  PRESCRIPTION_RETENTION_DAYS,
  PRESCRIPTION_RETENTION_DAYS_BY_TYPE,
  PRESCRIPTION_TYPES,
} from '@/types/prescriptionTypes';

const readProjectFile = (relativePath: string): string => {
  const absolutePath = path.resolve(__dirname, '../../../', relativePath);
  return fs.readFileSync(absolutePath, 'utf8');
};

const accessFunctionsSource = readProjectFile('functions/lib/prescriptionAccessFunctions.js');

describe('Prescription constants TS↔JS drift guard', () => {
  it('lists the same prescription types on both sides', () => {
    expect(PRESCRIPTION_TYPES).toEqual(['comun', 'psicotropicos', 'benzodiazepinas']);
    for (const type of PRESCRIPTION_TYPES) {
      expect(accessFunctionsSource).toContain(`'${type}'`);
    }
  });

  it('uses the same default monthly backup review window (30 days) for every type', () => {
    expect(PRESCRIPTION_RETENTION_DAYS).toBe(30);
    for (const type of PRESCRIPTION_TYPES) {
      expect(PRESCRIPTION_RETENTION_DAYS_BY_TYPE[type]).toBe(30);
    }
    expect(accessFunctionsSource).toMatch(
      /MONTHLY_BACKUP_DAYS_BY_TYPE\s*=\s*\{\s*comun:\s*30,\s*psicotropicos:\s*30,\s*benzodiazepinas:\s*30,?\s*\}/
    );
  });

  it('keeps the same PIN length bounds (4–12) on the Cloud Function', () => {
    expect(accessFunctionsSource).toMatch(/MIN_PIN_LENGTH\s*=\s*4\b/);
    expect(accessFunctionsSource).toMatch(/MAX_PIN_LENGTH\s*=\s*12\b/);
  });

  it('caps each base64 image blob at 4 MB on the Cloud Function', () => {
    expect(accessFunctionsSource).toMatch(/MAX_BASE64_BYTES\s*=\s*4\s*\*\s*1024\s*\*\s*1024/);
  });

  it('uses the same brute-force lockout policy (5 attempts → 15 min)', () => {
    expect(accessFunctionsSource).toMatch(/MAX_PIN_FAILED_ATTEMPTS\s*=\s*5\b/);
    expect(accessFunctionsSource).toMatch(/PIN_LOCKOUT_MINUTES\s*=\s*15\b/);
  });
});
