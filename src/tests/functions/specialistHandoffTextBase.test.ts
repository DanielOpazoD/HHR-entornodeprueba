/**
 * Synthetic-only: a specialist note never replaces a stored note saved after its edit began, and a
 * replay of a write the server already took changes nothing.
 */
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createSpecialistMedicalHandoffFunctions,
} = require('../../../functions/lib/specialistMedicalHandoffFunctions.js');
const context = {
  auth: { uid: 'synthetic-specialist', token: { email: 'specialist@example.invalid' } },
};
const identity = {
  patientName: 'Paciente A Sintético',
  rut: '99.999.999-9',
  documentType: 'RUT',
  clinicalEpisodeId: 'synthetic-episode-A',
};
const entries = (note: string) => [{ id: 'entry-A', specialty: 'Medicina Interna', note }];
/** The client's specialistHandoffTextState for a patient with that single entry. */
const textState = (note: string) => JSON.stringify([note, [['entry-A', note]]]);
const notePatch = (note: string) => ({
  'beds.R4.medicalHandoffEntries': entries(note),
  'beds.R4.medicalHandoffNote': note,
});

/** Applies a Firestore update's dotted paths, as the real transaction does. */
const setPath = (target: Record<string, unknown>, path: string, value: unknown) => {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    current[part] ??= {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
};

const setup = (storedNote: string) => {
  const record: Record<string, unknown> = {
    date: '2026-01-01',
    beds: {
      R4: {
        ...identity,
        medicalHandoffNote: storedNote,
        medicalHandoffEntries: entries(storedNote),
      },
    },
  };
  const update = vi.fn((patch: Record<string, unknown>) => {
    for (const [path, value] of Object.entries(patch)) setPath(record, path, value);
  });
  const api = createSpecialistMedicalHandoffFunctions({
    firestore: {
      collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({}) }) }) }),
      runTransaction: async (run: (transaction: unknown) => Promise<unknown>) =>
        run({
          get: async () => ({ exists: true, data: () => structuredClone(record) }),
          update: (_ref: unknown, patch: Record<string, unknown>) => update(patch),
        }),
    },
    Timestamp: { now: () => 'server-time' },
    resolveRoleForEmail: async () => 'admin',
  });
  const write = (
    note: string,
    {
      bases,
      mutationId,
      patch,
      occupant,
    }: {
      bases?: unknown;
      mutationId?: unknown;
      patch?: Record<string, unknown>;
      occupant?: Record<string, unknown>;
    } = {}
  ) =>
    api.updateSpecialistMedicalHandoff.run(
      {
        date: '2026-01-01',
        patch: patch ?? notePatch(note),
        expectedOccupants: [
          {
            bedId: 'R4',
            target: 'bed',
            ...identity,
            ...occupant,
            ...(bases === undefined ? {} : { handoffBases: bases }),
          },
        ],
        ...(mutationId === undefined ? {} : { mutationId }),
      },
      context
    );
  const stored = () => (record.beds as Record<string, Record<string, unknown>>).R4;
  return { write, update, record, stored };
};

describe('specialist note text base', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses a note whose edit started before another stored note, and writes nothing', async () => {
    const app = setup('Nota guardada después por un colega');
    await expect(
      app.write('Nota antigua sin conexión', { bases: [textState('')], mutationId: 'm-offline' })
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringContaining('R4'),
    });
    expect(app.update).not.toHaveBeenCalled();
  });

  it('writes over the text the edit started from and records the write id', async () => {
    const app = setup('Nota inicial');
    await expect(
      app.write('Nota corregida', { bases: [textState('Nota inicial')], mutationId: 'm-1' })
    ).resolves.toMatchObject({ success: true });
    expect(app.update).toHaveBeenCalledWith(
      expect.objectContaining({
        ...notePatch('Nota corregida'),
        'meta.lastMutationId': 'm-1',
        'meta.lastChangedPaths': ['beds.R4.medicalHandoffEntries', 'beds.R4.medicalHandoffNote'],
      })
    );
  });

  it('acknowledges a replay of the write it took last without writing it again', async () => {
    const app = setup('');
    const replay = () =>
      app.write('Nota de A ya publicada', { bases: [textState('')], mutationId: 'm-lost-answer' });
    await replay();
    app.update.mockClear();
    await expect(replay()).resolves.toMatchObject({ success: true, alreadyApplied: true });
    expect(app.update).not.toHaveBeenCalled();
  });

  it('records a digest of the write, never its text, beside the write id', async () => {
    const app = setup('');
    await app.write('Nota de A', { bases: [textState('')], mutationId: 'm-1' });
    expect(app.record.meta).toEqual({
      lastMutationId: 'm-1',
      lastMutationDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      lastChangedPaths: ['beds.R4.medicalHandoffEntries', 'beds.R4.medicalHandoffNote'],
    });
    expect(JSON.stringify(app.record.meta)).not.toContain('Nota de A');
  });

  it.each([
    ['another text', { note: 'Otro texto con el mismo envío' }],
    [
      'another episode',
      { note: 'Nota de A', occupant: { clinicalEpisodeId: 'synthetic-episode-B' } },
    ],
    ['another path', { note: 'Nota de A', patch: { 'beds.R4.medicalHandoffNote': 'Nota de A' } }],
  ])('refuses the same write id reused with %s, and stores nothing', async (_label, reuse) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = setup('');
    await app.write('Nota de A', { bases: [textState('')], mutationId: 'm-1' });
    app.update.mockClear();
    await expect(
      app.write(reuse.note, {
        bases: [textState('')],
        mutationId: 'm-1',
        ...('occupant' in reuse ? { occupant: reuse.occupant } : {}),
        ...('patch' in reuse ? { patch: reuse.patch } : {}),
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(app.update).not.toHaveBeenCalled();
    expect(app.stored().medicalHandoffNote).toBe('Nota de A');
    expect(warn).toHaveBeenCalledWith('specialist_handoff_write_id_reused', {
      date: '2026-01-01',
      bedId: 'R4',
    });
  });

  it.each([
    'beds.R4.medicalHandoffEntries.0.note',
    'beds.R4.medicalHandoffEntries.0',
    'beds.R4.medicalHandoffNote.extra',
    'beds.R4.medicalHandoffAudit.currentStatus',
    'beds.R4.clinicalEvents.0',
  ])('refuses the nested path %s, which the text check cannot protect', async path => {
    const app = setup('Nota guardada');
    await expect(
      app.write('', {
        bases: [textState('Nota anterior')],
        mutationId: 'm-nested',
        patch: { [path]: 'x' },
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(app.update).not.toHaveBeenCalled();
    expect(app.stored().medicalHandoffEntries).toEqual(entries('Nota guardada'));
  });

  it('takes a stored text this device already sent for the same note', async () => {
    const app = setup('Primera versión enviada');
    await expect(
      app.write('Segunda versión', {
        bases: [textState(''), textState('Primera versión enviada')],
        mutationId: 'm-2',
      })
    ).resolves.toMatchObject({ success: true });
    expect(app.update).toHaveBeenCalledTimes(1);
  });

  it('takes a write whose text the stored note already holds', async () => {
    const app = setup('Misma nota');
    await expect(
      app.write('Misma nota', { bases: [textState('')], mutationId: 'm-3' })
    ).resolves.toMatchObject({ success: true });
  });

  it('keeps the earlier payload without bases or write id working as before', async () => {
    const app = setup('Nota de un colega');
    await expect(app.write('Nota sin base')).resolves.toMatchObject({ success: true });
    expect(app.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ 'meta.lastMutationId': expect.anything() })
    );
  });

  it.each([[[]], [[1]], [Array.from({ length: 9 }, () => textState(''))], ['texto']])(
    'fails closed on malformed bases %j',
    async bases => {
      const app = setup('');
      await expect(app.write('Nota', { bases })).rejects.toMatchObject({
        code: 'failed-precondition',
      });
      expect(app.update).not.toHaveBeenCalled();
    }
  );

  it.each(['', 5, 'x'.repeat(201)])('rejects a malformed write id %j', async mutationId => {
    const app = setup('');
    await expect(app.write('Nota', { bases: [textState('')], mutationId })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(app.update).not.toHaveBeenCalled();
  });
});
