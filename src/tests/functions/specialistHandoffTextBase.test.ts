/**
 * Synthetic-only: a specialist note never replaces a stored note saved after its edit began, and a
 * replay of a write the server already took changes nothing.
 */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

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

const setup = (storedNote: string, meta?: Record<string, unknown>) => {
  const record = {
    date: '2026-01-01',
    ...(meta ? { meta } : {}),
    beds: {
      R4: {
        ...identity,
        medicalHandoffNote: storedNote,
        medicalHandoffEntries: entries(storedNote),
      },
    },
  };
  const update = vi.fn();
  const api = createSpecialistMedicalHandoffFunctions({
    firestore: {
      collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({}) }) }) }),
      runTransaction: async (run: (transaction: unknown) => Promise<unknown>) =>
        run({
          get: async () => ({ exists: true, data: () => structuredClone(record) }),
          update: (_ref: unknown, patch: unknown) => update(patch),
        }),
    },
    Timestamp: { now: () => 'server-time' },
    resolveRoleForEmail: async () => 'admin',
  });
  const write = (
    note: string,
    { bases, mutationId }: { bases?: unknown; mutationId?: unknown } = {}
  ) =>
    api.updateSpecialistMedicalHandoff.run(
      {
        date: '2026-01-01',
        patch: notePatch(note),
        expectedOccupants: [
          {
            bedId: 'R4',
            target: 'bed',
            ...identity,
            ...(bases === undefined ? {} : { handoffBases: bases }),
          },
        ],
        ...(mutationId === undefined ? {} : { mutationId }),
      },
      context
    );
  return { write, update };
};

describe('specialist note text base', () => {
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
    const app = setup('Nota de A ya publicada', { lastMutationId: 'm-lost-answer' });
    await expect(
      app.write('Nota de A ya publicada', {
        bases: [textState('')],
        mutationId: 'm-lost-answer',
      })
    ).resolves.toMatchObject({ success: true, alreadyApplied: true });
    expect(app.update).not.toHaveBeenCalled();
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
