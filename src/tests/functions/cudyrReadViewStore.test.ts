import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { saveReadView, readReadView } = require('../../../functions/lib/cudyrReadViewStore.js');
const report = () => ({
  schemaVersion: 1,
  from: '2026-10-01',
  to: '2026-10-12',
  generatedAt: '2026-10-18T08:00:00Z',
  readStartedAt: '2026-10-18T07:00:00Z',
  readIncomplete: false,
  rows: [
    {
      date: '2026-10-12',
      evaluation: { category: 'C2', adjustmentReason: 'Contingencia sintética' },
    },
  ],
  coverage: [{ date: '2026-10-12', state: 'disponible' }],
  exclusions: [{ date: '2026-10-12', reason: 'under_eight_hours' }],
  issues: [],
  observations: [],
  captures: [],
  corrections: [],
  dischargeAudit: [],
});
const harness = () => {
  const docs = new Map();
  const collection = vi.fn((name: string) => ({
    doc: (id: string) => ({
      path: `${name}/${id}`,
      get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
      id,
    }),
  }));
  const transaction = {
    get: (ref: { get: () => Promise<unknown> }) => ref.get(),
    set: (ref: { id: string }, value: unknown) => docs.set(ref.id, value),
  };
  const hospital = {
    collection,
    firestore: {
      runTransaction: async (fn: (tx: typeof transaction) => Promise<unknown>) => fn(transaction),
    },
  };
  return { hospital, docs, collection };
};
it('isolates the presentation copy per authenticated owner and preserves contingencies/exclusions', async () => {
  const h = harness(),
    value = report();
  const data = { from: value.from, to: value.to, report: value };
  await saveReadView({ hospital: h.hospital, data, uid: 'writer' });
  const saved = await readReadView(h.hospital, data, 'writer');
  expect(JSON.parse(gunzipSync(Buffer.from(saved.report, 'base64')).toString())).toEqual(value);
  expect(await readReadView(h.hospital, data, 'other')).toEqual({ state: 'missing' });
  expect(h.collection.mock.calls.every(([name]) => name === 'cudyrReadViews')).toBe(true);
});
it('refuses incomplete/official copies, forged owner/scope and invalid periods', async () => {
  const h = harness(),
    value = report();
  for (const patch of [
    { readIncomplete: true },
    { officialSnapshot: {} },
    { readViewSnapshot: 'old' },
  ])
    await expect(
      saveReadView({
        hospital: h.hospital,
        uid: 'writer',
        data: { from: value.from, to: value.to, report: { ...value, ...patch } },
      })
    ).rejects.toThrow();
  for (const patch of [
    { uid: 'other' },
    { hospitalId: 'other' },
    { to: '2026-11-31' },
    { to: '2026-12-01' },
  ])
    await expect(
      readReadView(h.hospital, { from: value.from, to: value.to, ...patch }, 'writer')
    ).rejects.toThrow();
  expect(h.docs.size).toBe(0);
});
it('does not let a slower old read overwrite a newer view', async () => {
  const h = harness(),
    value = report();
  const data = { from: value.from, to: value.to, report: value };
  await saveReadView({ hospital: h.hospital, data, uid: 'writer' });
  expect(
    await saveReadView({
      hospital: h.hospital,
      uid: 'writer',
      data: {
        ...data,
        report: {
          ...value,
          generatedAt: '2026-10-19T08:00:00Z',
          readStartedAt: '2026-10-17T07:00:00Z',
        },
      },
    })
  ).toEqual({ persisted: false });
});
