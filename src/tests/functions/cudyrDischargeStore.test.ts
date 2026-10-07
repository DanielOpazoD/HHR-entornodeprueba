import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CorrectCudyrDischargeRequest } from '@/types/domain/cudyrDischarge';
const require = createRequire(import.meta.url);
const { parseDischargeCorrection } = require('../../../functions/lib/cudyrDischargeContract.js');
const { saveDischargeCorrection } = require('../../../functions/lib/cudyrDischargeStore.js');
const actor = {
  uid: 'synthetic-user',
  email: 'test@example.com',
  name: 'Profesional sintético',
  role: 'nurse_hospital',
};
const request: CorrectCudyrDischargeRequest = {
  kind: 'correct-discharge',
  schemaVersion: 1,
  operationId: '00000000-0000-4000-8000-000000000001',
  authorityDate: '2026-10-06',
  clinicalEpisodeId: 'episode-test',
  expectedRevision: 0,
  actualDischarge: { date: '2026-10-05', time: '10:30', timeZone: 'Pacific/Easter' },
  reason: 'Salida física cotejada con registro de enfermería.',
  confirmed: true,
};
const harness = () => {
  const data = new Map<string, Record<string, unknown>>();
  const ref = (path: string) => ({
    path,
    id: path.split('/').at(-1),
    collection: (name: string) => ref(`${path}/${name}`),
    doc: (id: string) => ref(`${path}/${id}`),
  });
  const hospital = ref('hospitals/hanga_roa');
  const record = {
    date: request.authorityDate,
    beds: {},
    discharges: [
      {
        clinicalEpisodeId: request.clinicalEpisodeId,
        bedId: 'R1',
        patientName: 'Paciente sintético',
        movementDate: '2026-10-06',
        time: '14:00',
        originalData: {
          clinicalEpisodeId: request.clinicalEpisodeId,
          admissionDate: '2026-10-01',
          admissionTime: '09:00',
        },
      },
    ],
  };
  data.set(`hospitals/hanga_roa/dailyRecords/${request.authorityDate}`, record);
  const firestore = {
    runTransaction: async (operation: (transaction: unknown) => Promise<unknown>) => {
      const writes: Array<[string, Record<string, unknown>]> = [];
      const result = await operation({
        get: async ({ path }: { path: string }) => ({
          exists: data.has(path),
          data: () => data.get(path),
        }),
        set: (r: { path: string }, value: Record<string, unknown>) => writes.push([r.path, value]),
        create: (r: { path: string }, value: Record<string, unknown>) => {
          if (data.has(r.path)) throw new Error('duplicate');
          writes.push([r.path, value]);
        },
      });
      writes.forEach(([key, value]) => data.set(key, value));
      return result;
    },
  };
  const save = (next: Partial<CorrectCudyrDischargeRequest> = {}) =>
    saveDischargeCorrection({ firestore, hospital, actor, data: { ...request, ...next } });
  return { save, data, record };
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T01:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('audited actual discharge correction', () => {
  it('preserves source egreso and returns the same acknowledgement on an exact retry', async () => {
    const h = harness();
    const original = structuredClone(h.record);
    const first = await h.save();
    const retry = await h.save();
    expect(retry).toEqual(first);
    expect(first.correction).toMatchObject({
      revision: 1,
      actualDischarge: request.actualDischarge,
      updatedBy: actor,
    });
    expect(h.record).toEqual(original);
    expect([...h.data.keys()].filter(key => key.includes('/cudyrDischargeAudit/'))).toHaveLength(1);
  });
  it('acknowledges an identical retry even after the authority census changes or disappears', async () => {
    const h = harness();
    const first = await h.save();
    h.record.discharges[0].originalData.admissionDate = '';
    expect(await h.save()).toEqual(first);
    h.data.delete(`hospitals/hanga_roa/dailyRecords/${request.authorityDate}`);
    expect(await h.save()).toEqual(first);
    await expect(
      h.save({ operationId: '00000000-0000-4000-8000-000000000002', expectedRevision: 1 })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('requires a fresh revision and records every old/new value when clearing or correcting', async () => {
    const h = harness();
    await h.save();
    await expect(
      h.save({ operationId: '00000000-0000-4000-8000-000000000002' })
    ).rejects.toMatchObject({ code: 'aborted' });
    const cleared = await h.save({
      operationId: '00000000-0000-4000-8000-000000000002',
      expectedRevision: 1,
      actualDischarge: null,
      reason: 'Fecha pendiente de verificación.',
    });
    expect(cleared.correction).toMatchObject({ revision: 2, actualDischarge: null });
    const audit = [...h.data.entries()]
      .filter(([key]) => key.includes('/cudyrDischargeAudit/'))
      .map(([, value]) => value);
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({
      previousRevision: 1,
      previousDischarge: request.actualDischarge,
    });
  });
  it('does not acknowledge a reused operation ID with a different correction', async () => {
    const h = harness();
    await h.save();
    await expect(h.save({ reason: 'Un motivo diferente.' })).rejects.toMatchObject({
      code: 'already-exists',
    });
  });
  it.each([
    { date: '2026-09-30', timeZone: 'Pacific/Easter' },
    { date: '2026-10-01', time: '08:59', timeZone: 'Pacific/Easter' },
    { date: '2026-10-07', timeZone: 'Pacific/Easter' },
    { date: '2026-10-06', time: '20:01', timeZone: 'Pacific/Easter' },
  ] as const)(
    'rejects impossible chronology in the hospital timezone: %s',
    async actualDischarge => {
      await expect(harness().save({ actualDischarge })).rejects.toMatchObject({
        code: 'invalid-argument',
      });
    }
  );
  it('keeps an unknown discharge time absent instead of manufacturing midnight', async () => {
    const result = await harness().save({
      actualDischarge: { date: '2026-10-05', timeZone: 'Pacific/Easter' },
    });
    expect(result.correction.actualDischarge).not.toHaveProperty('time');
  });
  it('rejects an episode absent from the authoritative census even with the same patient name', async () => {
    await expect(harness().save({ clinicalEpisodeId: 'different-episode' })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });
  it('does not accept missing admission evidence', async () => {
    const h = harness();
    h.record.discharges[0].originalData.admissionDate = '';
    await expect(h.save()).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it.each([
    { confirmed: false },
    { expectedRevision: -1 },
    { expectedRevision: 0.1 },
    { hospitalId: 'other' },
    { reason: '' },
    { reason: 'x'.repeat(501) },
    { actualDischarge: { date: '2026-02-30', timeZone: 'Pacific/Easter' } },
    { actualDischarge: { date: '2026-10-05', time: '24:00', timeZone: 'Pacific/Easter' } },
    { actualDischarge: { date: '2026-10-05', timeZone: 'America/Santiago' } },
  ])('rejects malformed or unconfirmed correction: %s', invalid => {
    expect(() => parseDischargeCorrection({ ...request, ...invalid })).toThrow();
  });
});
