// @vitest-environment node
/**
 * Static drift guard between the prescription constants declared in TS
 * (`src/features/prescriptions/types/prescriptionTypes.ts`) and the parallel constants used by
 * the Cloud Functions (`functions/lib/prescriptionAccessFunctions.js`).
 *
 * The two layers can't share a module (Node CommonJS in functions/ vs
 * TS aliases in src/), so we accept the duplication and pin the values
 * here. If anyone changes one side without the other, this test fires
 * before the bug ships.
 */

import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { createRequire } from 'node:module';
import path from 'path';

import {
  PRESCRIPTION_RETENTION_DAYS,
  PRESCRIPTION_RETENTION_DAYS_BY_TYPE,
  PRESCRIPTION_TYPES,
} from '@/features/prescriptions/types/prescriptionTypes';

vi.mock('firebase-functions/v1', () => ({
  https: {
    onCall: (handler: unknown) => ({ run: handler }),
    HttpsError: class HttpsError extends Error {},
  },
}));

const requireFromHere = createRequire(import.meta.url);
const { computeExpiresAt } = requireFromHere(
  '../../../functions/lib/prescriptionAccessFunctions.js'
) as {
  computeExpiresAt: (prescriptionType: string, createdAtIso: string) => string;
};

const readProjectFile = (relativePath: string): string => {
  const absolutePath = path.resolve(__dirname, '../../../', relativePath);
  return fs.readFileSync(absolutePath, 'utf8');
};

const accessFunctionsSource = readProjectFile('functions/lib/prescriptionAccessFunctions.js');
const pinAuthSource = readProjectFile('functions/lib/prescriptionPinAuth.js');

describe('Prescription constants TS↔JS drift guard', () => {
  it('lists the same prescription types on both sides', () => {
    expect(PRESCRIPTION_TYPES).toEqual(['comun', 'psicotropicos', 'benzodiazepinas']);
    for (const type of PRESCRIPTION_TYPES) {
      expect(accessFunctionsSource).toContain(`'${type}'`);
    }
  });

  it('uses the same default monthly backup review window (30 days) for every type', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const createdAtIso = '2026-05-04T12:00:00.000Z';
    const expectedIndependentExpiry = '2026-06-03T12:00:00.000Z';

    expect(PRESCRIPTION_RETENTION_DAYS).toBe(30);
    for (const type of PRESCRIPTION_TYPES) {
      const clientDays = PRESCRIPTION_RETENTION_DAYS_BY_TYPE[type];
      expect(clientDays).toBe(30);
      const clientExpectedIso = new Date(
        Date.parse(createdAtIso) + clientDays * DAY_MS
      ).toISOString();
      const functionExpiry = computeExpiresAt(type, createdAtIso);
      expect(functionExpiry).toBe(clientExpectedIso);
      expect(functionExpiry).toBe(expectedIndependentExpiry);
    }
    expect(computeExpiresAt('legacy_unknown', createdAtIso)).toBe(expectedIndependentExpiry);
  });

  it('keeps the same PIN length bounds (4–12) on the Cloud Function', () => {
    expect(pinAuthSource).toMatch(/MIN_PIN_LENGTH\s*=\s*4\b/);
    expect(pinAuthSource).toMatch(/MAX_PIN_LENGTH\s*=\s*12\b/);
  });

  it('caps each base64 image blob at 4 MB on the Cloud Function', () => {
    expect(accessFunctionsSource).toMatch(/MAX_BASE64_BYTES\s*=\s*4\s*\*\s*1024\s*\*\s*1024/);
  });

  it('uses the same brute-force lockout policy (5 attempts → 15 min)', () => {
    expect(pinAuthSource).toMatch(/MAX_PIN_FAILED_ATTEMPTS\s*=\s*5\b/);
    expect(pinAuthSource).toMatch(/PIN_LOCKOUT_MINUTES\s*=\s*15\b/);
  });
});
