import { describe, expect, it } from 'vitest';

import {
  buildAdminHarness,
  createValidatePinHandler,
  seedPin,
} from './prescriptionAccessFunctions.testSupport';

describe('validatePrescriptionAccessPin under concurrent attempts', () => {
  it('counts concurrent failed attempts below the lockout threshold', async () => {
    const { admin, accessConfig } = buildAdminHarness();
    await seedPin(accessConfig, '7351');
    const handler = createValidatePinHandler({ firestore: admin.firestore() });

    const results = await Promise.allSettled(
      ['0000', '0001', '0002', '0003'].map(pin => handler({ pin }, undefined))
    );

    expect(results.map(result => result.status)).toEqual(Array(4).fill('rejected'));
    expect(accessConfig.data?.failedAttempts).toBe(4);
    expect(accessConfig.data?.lockedUntil).toBeUndefined();
    await expect(handler({ pin: '7351' }, undefined)).resolves.toEqual({ valid: true });
    expect(accessConfig.data?.failedAttempts).toBe(0);
  });

  it('locks the PIN endpoint when concurrent failed attempts reach the threshold', async () => {
    const { admin, accessConfig } = buildAdminHarness();
    await seedPin(accessConfig, '7351');
    const handler = createValidatePinHandler({ firestore: admin.firestore() });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) => handler({ pin: `000${index}` }, undefined))
    );

    expect(results.map(result => result.status)).toEqual(Array(8).fill('rejected'));
    expect(accessConfig.data?.lockedUntil).toBe('2026-05-04T12:15:00.000Z');
    expect(accessConfig.data?.failedAttempts).toBe(0);
    await expect(handler({ pin: '7351' }, undefined)).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'Demasiados intentos fallidos. Reintenta en 15 minuto(s).',
    });
  });
});
