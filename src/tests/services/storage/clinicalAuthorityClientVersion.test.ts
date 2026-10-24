/**
 * Clinical authority callables carry the client runtime contract version as its own top-level
 * field (D7 of DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md): outside `syncContract`, digests and
 * receipts, so an idempotent retry still matches. The Rayen batch client is covered in
 * rayenClinicalEnrichmentBatchClient.test.ts. Synthetic data only.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const { invoke, httpsCallable } = vi.hoisted(() => ({ invoke: vi.fn(), httpsCallable: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable }));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getRegionalFunctions: async () => ({}) },
}));

import { CLIENT_RUNTIME_CONTRACT_VERSION } from '@/constants/runtimeContracts';
import {
  CLIENT_RUNTIME_CONTRACT_VERSION_FIELD,
  CLINICAL_DERIVED_MIN_CLIENT_RUNTIME_CONTRACT_VERSION,
} from '@/services/storage/clinicalDerivedConstants';
import {
  patchDailyRecordWithClinicalAuthorityCallable as patch,
  saveDailyRecordWithClinicalAuthorityCallable as save,
} from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';

const date = '2026-11-02';
const syncContract = { mutationId: 'synthetic-mutation', changedPaths: ['beds.R1.cudyr'] };
const record = { date, lastUpdated: `${date}T10:00:00.000Z`, beds: {} } as unknown as DailyRecord;

beforeEach(() => {
  vi.clearAllMocks();
  httpsCallable.mockReturnValue(invoke);
  invoke.mockResolvedValue({ data: { success: true, date } });
});

describe('clinical authority callables · client runtime contract version', () => {
  // D7 trusts v3 to build moved fields from the combined view, and the published minimum is only a
  // warning: a v3 build whose Rayen fill still reads the plain day would overwrite an episode's
  // vitals history with the Rayen window. The claim and the D10 wiring land together.
  it('claims the split-day minimum only once the Rayen fill reads the combined view (D10)', () => {
    const featureDir = path.resolve(__dirname, '../../../features/rayen-import');
    const wired = readdirSync(featureDir, { recursive: true, encoding: 'utf8' })
      .filter(file => /\.tsx?$/.test(file))
      .some(file =>
        readFileSync(path.join(featureDir, file), 'utf8').includes(
          'dailyRecordClinicalDerivedReadService'
        )
      );
    expect(
      CLIENT_RUNTIME_CONTRACT_VERSION >= CLINICAL_DERIVED_MIN_CLIENT_RUNTIME_CONTRACT_VERSION
    ).toBe(wired);
    expect(CLIENT_RUNTIME_CONTRACT_VERSION_FIELD).toBe('clientRuntimeContractVersion');
  });

  it.each([
    [
      'saveDailyRecordWithClinicalAuthority',
      () => save({ date, record, mode: 'shadow', syncContract }),
      { date, record, mode: 'shadow', syncContract },
    ],
    [
      'patchDailyRecordWithClinicalAuthority',
      () =>
        patch({
          date,
          patch: { 'beds.R1.cudyr': { changeClothes: 2 } },
          mode: 'shadow',
          origin: 'legacy_guarded_clinical_patch',
          syncContract,
        }),
      {
        date,
        patch: { 'beds.R1.cudyr': { changeClothes: 2 } },
        mode: 'shadow',
        origin: 'legacy_guarded_clinical_patch',
        syncContract,
      },
    ],
  ])('%s sends it top-level, outside syncContract', async (name, call, payload) => {
    await call();

    expect(httpsCallable).toHaveBeenCalledWith({}, name, expect.any(Object));
    expect(invoke).toHaveBeenCalledExactlyOnceWith({
      ...payload,
      clientRuntimeContractVersion: CLIENT_RUNTIME_CONTRACT_VERSION,
    });
    const sent = invoke.mock.calls[0][0] as { syncContract: Record<string, unknown> };
    expect(sent.syncContract).toEqual(syncContract);
    expect(syncContract).not.toHaveProperty('clientRuntimeContractVersion');
  });

  it('does not mutate the caller’s payload', async () => {
    const payload = { date, record, mode: 'enforced' as const, syncContract };
    await save(payload);
    expect(payload).not.toHaveProperty('clientRuntimeContractVersion');
  });
});
