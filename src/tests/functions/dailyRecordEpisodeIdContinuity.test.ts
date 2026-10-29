import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicalSyncCheckpointSchema } from '@/schemas/zod/patient';
import { ensureDailyRecordClinicalEpisodeIds } from '@/application/patient-flow/clinicalEpisodeIdPolicy';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

const stamp = '2026-05-13T12:00:00.000Z';
const checkpoint = {
  version: 3,
  fingerprintVersion: 1,
  sources: { vitals: { watermark: 'synthetic-saved-vitals' } },
};
const layout = { version: 1, generation: 'synthetic-existing-generation' };
const fencedPolicy = { schemaVersion: 2, clinicalBatchMode: 'enforced', mode: 'auto', revision: 7 };

const storedDay = (marked: boolean) => ({
  ...makeRecord(),
  lastUpdated: stamp,
  meta: { revision: 2, lastMutationId: 'synthetic-prior' },
  ...(marked ? { clinicalDerivedLayout: layout } : {}),
  beds: {
    R1: {
      ...makeRecord().beds.R1,
      patientName: 'Paciente Sintetico Continuidad',
      rut: 'SYNTHETIC-P123',
      documentType: 'Pasaporte',
      admissionDate: '2026-05-13',
      admissionTime: '08:00',
      clinicalEpisodeId: 'ep_saved',
      clinicalSyncCheckpoint: structuredClone(checkpoint),
    },
  },
});

const setup = (remote: ReturnType<typeof storedDay> | undefined, fenced = false) => {
  const mock = createAdminMock({
    remoteData: remote,
    ...(fenced ? { policyData: fencedPolicy } : {}),
  });
  const api = createDailyRecordWriteAuthorityFunctions({
    firestore: mock.admin.firestore(),
    Timestamp: mock.admin.firestore.Timestamp,
    resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
  });
  return {
    ...mock,
    save: (
      record: ReturnType<typeof makeRecord>,
      options: { origin?: string; expectedLastUpdated?: string; baseRevision?: number } = {}
    ) =>
      api.saveDailyRecordWithClinicalAuthority.run(
        {
          date: record.date,
          record,
          expectedLastUpdated: options.expectedLastUpdated ?? stamp,
          mode: 'enforced',
          origin: options.origin ?? 'outbox',
          clientRuntimeContractVersion: 3,
          syncContract: {
            mutationId: 'synthetic-continuity-save',
            baseRevision: options.baseRevision ?? 2,
            changedPaths: ['*'],
          },
        },
        makeContext()
      ),
    patch: (patch: Record<string, unknown>) =>
      api.patchDailyRecordWithClinicalAuthority.run(
        {
          date: remote?.date,
          patch,
          expectedLastUpdated: stamp,
          mode: 'enforced',
          origin: 'outbox',
          clientRuntimeContractVersion: 3,
          syncContract: {
            mutationId: 'synthetic-continuity-patch',
            baseRevision: 2,
            changedPaths: Object.keys(patch),
          },
        },
        makeContext()
      ),
  };
};

beforeEach(() => {
  expect(ClinicalSyncCheckpointSchema.safeParse(checkpoint).success).toBe(true);
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(stamp) });
});
afterEach(() => vi.useRealTimers());

describe.each([
  { label: 'unmarked day', marked: false },
  { label: 'marked day with an unsplit episode', marked: true },
])('opaque full-save episode continuity on $label', ({ marked }) => {
  it('rejects a generated replacement without writes', async () => {
    const remote = storedDay(marked);
    const idlessCopy = {
      ...structuredClone(remote),
      beds: { R1: { ...structuredClone(remote.beds.R1), clinicalEpisodeId: undefined } },
    };
    const incoming = ensureDailyRecordClinicalEpisodeIds(idlessCopy);
    expect(incoming.beds.R1.clinicalEpisodeId).toMatch(/^legacy_ep_[a-z0-9]+$/);
    expect(incoming.beds.R1.clinicalEpisodeId).not.toBe('ep_saved');
    const { save, set, update, historySet } = setup(remote);
    await expect(save(incoming)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(historySet).not.toHaveBeenCalled();
  });

  it('successfully saves the same explicit ID and retains its checkpoint', async () => {
    const remote = storedDay(marked);
    const { save, set, update, historySet, docRef } = setup(remote);
    const response = await save(structuredClone(remote));

    expect(response).toMatchObject({
      success: true,
      revision: 3,
      recordState: {
        record: {
          beds: { R1: { clinicalEpisodeId: 'ep_saved', clinicalSyncCheckpoint: checkpoint } },
        },
      },
    });
    expect(set).toHaveBeenCalledExactlyOnceWith(
      docRef,
      expect.objectContaining({
        beds: {
          R1: expect.objectContaining({
            clinicalEpisodeId: 'ep_saved',
            clinicalSyncCheckpoint: checkpoint,
          }),
        },
        ...(marked ? { clinicalDerivedLayout: layout } : {}),
        meta: expect.objectContaining({ revision: 3 }),
      })
    );
    expect(update).not.toHaveBeenCalled();
    expect(historySet).toHaveBeenCalledOnce();
  });
});

describe('episode continuity of sibling and restore paths', () => {
  it('still permits adoption of a non-legacy source ID', async () => {
    const remote = storedDay(false);
    const incoming = structuredClone(remote);
    incoming.beds.R1.clinicalEpisodeId = 'EloisaSourceEpisode';
    const { save, set } = setup(remote);

    await expect(save(incoming)).resolves.toMatchObject({
      success: true,
      recordState: {
        record: {
          beds: {
            R1: {
              clinicalEpisodeId: 'EloisaSourceEpisode',
              clinicalSyncCheckpoint: checkpoint,
            },
          },
        },
      },
    });
    expect(set).toHaveBeenCalledOnce();
  });

  it('rejects an administrative structural ID patch with the clinical fence active', async () => {
    const remote = storedDay(true);
    const generated = ensureDailyRecordClinicalEpisodeIds({
      ...structuredClone(remote),
      beds: { R1: { ...structuredClone(remote.beds.R1), clinicalEpisodeId: undefined } },
    }).beds.R1.clinicalEpisodeId;
    const { patch, set, update, historySet } = setup(remote, true);

    await expect(patch({ 'beds.R1.clinicalEpisodeId': generated })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(historySet).not.toHaveBeenCalled();
  });

  it('rejects an obsolete backup identity even when restored against the current base', async () => {
    const remote = storedDay(true);
    const backup = structuredClone(remote);
    backup.beds.R1.clinicalEpisodeId = 'legacy_ep_old_backup';
    const { save, set, update, historySet } = setup(remote, true);

    await expect(save(backup, { origin: 'backup_restore' })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(historySet).not.toHaveBeenCalled();
  });

  it('rejects a stale backup before it can replace a newly promoted episode id', async () => {
    const remote = storedDay(false);
    const backup = {
      ...structuredClone(remote),
      lastUpdated: '2026-05-13T11:00:00.000Z',
      meta: { revision: 1, lastMutationId: 'synthetic-backup' },
      beds: {
        R1: { ...structuredClone(remote.beds.R1), clinicalEpisodeId: 'legacy_ep_old_backup' },
      },
    };
    const { save, set, update, historySet } = setup(remote, true);

    await expect(
      save(backup, {
        origin: 'backup_restore',
        expectedLastUpdated: backup.lastUpdated,
        baseRevision: 1,
      })
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(historySet).not.toHaveBeenCalled();
  });

  it('still recreates a missing day from its backup with the original identity and checkpoint', async () => {
    const backup = storedDay(false);
    backup.beds.R1.clinicalEpisodeId = 'legacy_ep_old_backup';
    const { save, set } = setup(undefined, true);

    const response = await save(backup, { origin: 'backup_restore', baseRevision: 0 });

    expect(response).toMatchObject({
      success: true,
      recordState: {
        record: {
          beds: {
            R1: { clinicalEpisodeId: 'legacy_ep_old_backup', clinicalSyncCheckpoint: checkpoint },
          },
        },
      },
    });
    expect(set).toHaveBeenCalledOnce();
  });
});
