import { onTestFinished, vi } from 'vitest';
import * as fence from '@/services/storage/firestore/firestoreRayenClinicalAuthorityMode';

/**
 * Stands in for the schema-v2 Rayen policy, the only switch that routes day writes through the
 * authority callable, for the rest of the current test.
 */
export const activateServerWriteFence = (): void => {
  const spy = vi.spyOn(fence, 'isServerClinicalWriteFenceActive').mockResolvedValue(true);
  onTestFinished(() => spy.mockRestore());
};
