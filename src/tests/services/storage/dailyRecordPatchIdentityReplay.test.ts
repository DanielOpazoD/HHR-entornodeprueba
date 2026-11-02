import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { A, E, harnessState, reconnect } from './specialistHandoffOutboxHarness';
import {
  MODES,
  local,
  queue,
  readStored,
  remote,
  remoteWrite,
  resetNoteDay,
  writeDay,
} from './specialistHandoffNoteDaySupport';
import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';

const h = harnessState();
beforeEach(() => resetNoteDay('user:synthetic-patch-identity'));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each(MODES)('ordinary clinical patch identity (%s)', (_mode, enforced) => {
  it.each([
    ['bed', 'patient'],
    ['bed', 'episode'],
    ['crib', 'patient'],
    ['crib', 'episode'],
  ] as const)('retains an unchanged field for a different %s %s', async (slot, change) => {
    const before = E();
    const after = E(
      change === 'patient'
        ? {
            patientName: 'Otra persona sintética',
            rut: '55.555.555-5',
          }
        : { clinicalEpisodeId: 'ep-readmission' }
    );
    const path = slot === 'bed' ? 'beds.R6.pathology' : 'beds.R4.clinicalCrib.pathology';
    await readStored(
      slot === 'bed' ? { R4: A(), R6: before } : { R4: A('R4', { clinicalCrib: before }) },
      undefined,
      { revision: 1 }
    );
    await writeDay({ [path]: 'EDICION SOLO PARA EL EPISODIO ORIGINAL' });
    const [pending] = await queue();
    expect(pending.patchBaseValues?.[path]).toBe('Dx E');
    remoteWrite(
      slot === 'bed' ? { R4: A(), R6: after } : { R4: A('R4', { clinicalCrib: after }) },
      '2026-10-24T10:15:00.000Z',
      { revision: 2, lastChangedPaths: [path] }
    );
    h.authorityMode = enforced;

    await reconnect();

    expect(getValueAtPath(remote(), path)).toBe('Dx E');
    expect(getValueAtPath(remote(), path.replace('pathology', 'clinicalEpisodeId'))).toBe(
      after.clinicalEpisodeId
    );
    const retained = await queue();
    expect(retained).toHaveLength(1);
    expect(retained[0]).toMatchObject({
      status: 'CONFLICT',
      payload: pending.payload,
      syncContract: { changedPaths: [path] },
    });
    await reconnect();
    expect(await queue()).toEqual(retained);
    expect(getValueAtPath(remote(), path)).toBe('Dx E');
  });

  it('publishes an ordinary edit with the original identities after another bed changes', async () => {
    await readStored({ R4: A(), R6: E() }, undefined, { revision: 1 });
    await writeDay({ 'beds.R6.pathology': 'EDICION COMPATIBLE' });
    remoteWrite(
      { R4: A('R4', { pathology: 'OTRA EDICION COMPATIBLE' }), R6: E() },
      '2026-10-24T10:15:00.000Z',
      { revision: 2, lastChangedPaths: ['beds.R4.pathology'] }
    );
    h.authorityMode = enforced;

    await reconnect();

    expect(remote().beds.R6.pathology).toBe('EDICION COMPATIBLE');
    expect(remote().beds.R4.pathology).toBe('OTRA EDICION COMPATIBLE');
    expect((await local()).beds.R6.pathology).toBe('EDICION COMPATIBLE');
    expect(await queue()).toEqual([]);
  });
});
