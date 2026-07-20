// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

interface ClinicalCribRuntime {
  parentBedIdFromLabel: (value: string) => string | null;
  buildAssignments: (value: unknown[]) => Array<{
    encounterId: string;
    parentBedId: string;
    cribBedId: string;
  }>;
  enrichSnapshot: <T extends { encounters: Array<Record<string, unknown>> }>(
    snapshot: T,
    assignments: Array<{ encounterId: string; parentBedId: string }>
  ) => T;
  enrichSnapshotRequest: (
    response: Promise<{ snapshot: { encounters: Array<Record<string, unknown>> } }>,
    gestionCamasRuntime: Record<string, (...args: unknown[]) => unknown>,
    fetchWithTimeout: (...args: unknown[]) => Promise<unknown>
  ) => Promise<{ snapshot: { encounters: Array<Record<string, unknown>> } }>;
}

const context = vm.createContext({});
vm.runInContext(
  readFileSync(path.resolve('extension/gestion-camas-clinical-cribs.js'), 'utf8'),
  context
);
const runtime = (context as unknown as { HhrGestionCamasClinicalCribs: ClinicalCribRuntime })
  .HhrGestionCamasClinicalCribs;

describe('Gestión de Camas clinical-crib mapping', () => {
  it('wires the verified bed inventory into the snapshot route', () => {
    const background = readFileSync(path.resolve('extension/background.js'), 'utf8');
    expect(background).toContain("'gestion-camas-clinical-cribs.js'");
    const runtimeSource = readFileSync(
      path.resolve('extension/gestion-camas-clinical-cribs.js'),
      'utf8'
    );
    expect(runtimeSource).toContain('/facility/${encodeURIComponent(record.facId)}/beds');
    expect(background).toContain('HhrGestionCamasClinicalCribs.enrichSnapshotRequest(');
  });

  it.each([
    ['CH4C1', 'H4C1'], ['CH4C2', 'H4C2'], ['CH5C1', 'H5C1'], ['CH5C2', 'H5C2'],
    ['CH6C1', 'H6C1'], ['CH6C2', 'H6C2'], ['C-R1', 'R1'], ['C-R2', 'R2'],
    ['C-R3', 'R3'], ['C-R4', 'R4'], ['CNEO1', 'NEO1'], ['CNeo2', 'NEO2'],
  ])('maps the installed crib %s to parent bed %s', (label, parentBedId) => {
    expect(runtime.parentBedIdFromLabel(label)).toBe(parentBedId);
  });

  it('accepts the descriptive Gestion de Camas name without treating a principal bed as a crib', () => {
    expect(runtime.parentBedIdFromLabel('Cuna H5C1')).toBe('H5C1');
    expect(runtime.parentBedIdFromLabel('H5C1')).toBeNull();
  });

  it('rejects cribs outside the installed inventory and ignores free records', () => {
    expect(runtime.parentBedIdFromLabel('Cuna H3C1')).toBeNull();
    expect(runtime.buildAssignments([
      { name: 'Cuna H5C1', shortName: 'CH5C1', encounterId: 141814 },
      { name: 'Cuna R1', shortName: 'C-R1', encounterId: 0 },
      { name: 'Cuna H3C1', shortName: 'CH3C1', encounterId: 999 },
    ])).toEqual([
      { encounterId: '141814', parentBedId: 'H5C1', cribBedId: 'CH5C1' },
    ]);
  });

  it('adds only the verified parent relation to the matching Ficha encounter', () => {
    const snapshot = {
      capturedAt: '2026-07-20T13:00:00-06:00',
      encounters: [{ encounterId: '141814' }, { encounterId: '141815' }],
    };

    expect(runtime.enrichSnapshot(snapshot, [
      { encounterId: '141814', parentBedId: 'H5C1' },
      { encounterId: '141815', parentBedId: 'H3C1' },
    ])).toEqual({
      ...snapshot,
      encounters: [
        { encounterId: '141814', clinicalCribParentBedId: 'H5C1' },
        { encounterId: '141815' },
      ],
    });
  });

  it('enriches from an authenticated bed inventory and degrades safely when unavailable', async () => {
    const snapshotResponse = { snapshot: { encounters: [{ encounterId: '141814' }] } };
    const gestionCamasRuntime = {
      resolveSession: async () => ({
        record: { apiBase: 'https://hospital.test/api', facId: 1342, token: 'secret' },
      }),
      classifyRejection: async () => 'forbidden',
      markSessionVerified: async () => true,
    };
    const fetchWithTimeout = async () => ({
      ok: true,
      json: async () => [{ shortName: 'CH5C1', encounterId: 141814 }],
    });

    await expect(runtime.enrichSnapshotRequest(
      Promise.resolve(snapshotResponse),
      gestionCamasRuntime,
      fetchWithTimeout
    )).resolves.toEqual({
      snapshot: {
        encounters: [{ encounterId: '141814', clinicalCribParentBedId: 'H5C1' }],
      },
    });

    await expect(runtime.enrichSnapshotRequest(
      Promise.resolve(snapshotResponse),
      { ...gestionCamasRuntime, resolveSession: async () => ({ record: null }) },
      async () => { throw new Error('must not fetch'); }
    )).resolves.toEqual(snapshotResponse);

    await expect(runtime.enrichSnapshotRequest(
      Promise.resolve(snapshotResponse),
      { ...gestionCamasRuntime, resolveSession: async () => { throw new Error('storage'); } },
      async () => { throw new Error('must not fetch'); }
    )).resolves.toEqual(snapshotResponse);
  });
});
