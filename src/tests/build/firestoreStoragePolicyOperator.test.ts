import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import policies from '../../../firestore.indexes.json';

const cliMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({
  execFileSync: cliMock,
  default: { execFileSync: cliMock },
}));
const originalArgs = process.argv;
const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
const prefix = 'projects/hhr-pruebas/databases/(default)/collectionGroups/';
const run = async (project = 'hhr-pruebas', apply = false) => {
  process.argv = ['node', 'operator', `--project=${project}`, ...(apply ? ['--apply'] : [])];
  await import('../../../scripts/apply-firestore-storage-policy.mjs');
};
const isUpdate = (args: string[]) => args.includes('update');
beforeEach(() => {
  vi.resetModules();
  cliMock.mockReset();
  cliMock.mockImplementation((_program, args: string[]) =>
    JSON.stringify(isUpdate(args) ? { name: 'operation/synthetic' } : [])
  );
});
afterEach(() => {
  process.argv = originalArgs;
  logs.mockClear();
});

describe('Firestore storage operator boundaries', () => {
  it('defaults to read-only and lets gcloud manage its credentials', async () => {
    await run();
    expect(cliMock).toHaveBeenCalledTimes(3);
    expect(
      cliMock.mock.calls.every(([program, args]) => program === 'gcloud' && args.includes('list'))
    ).toBe(true);
  });
  it('only changes field metadata and the narrowly scoped conflict TTL policy', async () => {
    await run('hhr-pruebas', true);
    const writes = cliMock.mock.calls.filter(([, args]) => isUpdate(args));
    expect(writes).toHaveLength(24);
    expect(
      writes
        .filter(([, args]) => args.some((arg: string) => arg.includes('clinicalDerived')))
        .map(([, args]) => `${args[4]} ${args[5]}`)
        .sort()
    ).toEqual([
      'clinicalDerivedPrevious --collection-group=history',
      'clinicalSyncCheckpoint --collection-group=clinicalDerived',
      'vitalSignsHistory --collection-group=clinicalDerived',
    ]);
    expect(
      writes.every(
        ([, args]) =>
          args.includes('--project=hhr-pruebas') && args.includes('--database=(default)')
      )
    ).toBe(true);
    const ttlWrites = writes.filter(([, args]) => args.includes('--enable-ttl'));
    expect(
      ttlWrites
        .map(([, args]) => args.find((arg: string) => arg.startsWith('--collection-group=')))
        .sort()
    ).toEqual(['--collection-group=conflictSnapshots']);
    expect(
      writes.every(([, args]) => !args.includes('composite') && !args.includes('documents'))
    ).toBe(true);
  });
  it('does not activate the staging specialty policy in the published project', async () => {
    await run('hhr-serviciohospitalizados', true);
    const writes = cliMock.mock.calls.filter(([, args]) => isUpdate(args));
    expect(writes.every(([, args]) => args.includes('--project=hhr-serviciohospitalizados'))).toBe(
      true
    );
    expect(writes.some(([, args]) => args.includes('--collection-group=specialtyAiRequests'))).toBe(
      false
    );
  });
  it('refuses a reverting exemption before changing any field', async () => {
    cliMock.mockImplementation((_program, args: string[]) =>
      JSON.stringify(
        args[2] === 'fields'
          ? [
              {
                name: `${prefix}dailyRecords/fields/beds`,
                indexConfig: { reverting: true },
              },
            ]
          : []
      )
    );
    await expect(run('hhr-pruebas', true)).rejects.toThrow('Exemption reverting');
    expect(cliMock.mock.calls.every(([, args]) => !isUpdate(args))).toBe(true);
  });
  it('rejects a TTL offset that would change the recovery window', async () => {
    cliMock.mockImplementation((_program, args: string[]) =>
      JSON.stringify(
        args[2] === 'ttls'
          ? [
              {
                name: `${prefix}conflictSnapshots/fields/expireAt`,
                ttlConfig: { state: 'ACTIVE', expirationOffset: '86400s' },
              },
            ]
          : []
      )
    );
    await expect(run('hhr-pruebas', true)).rejects.toThrow('Different TTL expiration offset');
    expect(cliMock.mock.calls.every(([, args]) => !isUpdate(args))).toBe(true);
  });
  it('refuses an explicit child index before the first mutation', async () => {
    cliMock.mockImplementation((_program, args: string[]) =>
      JSON.stringify(
        args[2] === 'fields'
          ? [
              {
                name: `${prefix}dailyRecords/fields/beds.R1.patientName`,
                indexConfig: { indexes: [{ queryScope: 'COLLECTION' }] },
              },
            ]
          : []
      )
    );
    await expect(run('hhr-pruebas', true)).rejects.toThrow('Explicit child index');
    expect(cliMock.mock.calls.every(([, args]) => !isUpdate(args))).toBe(true);
  });
  it('refuses a composite query over an exemption before changing any field', async () => {
    cliMock.mockImplementation((_program, args: string[]) =>
      JSON.stringify(
        args[2] === 'composite'
          ? [
              {
                name: `${prefix}dailyRecords/indexes/existing`,
                fields: [{ fieldPath: 'beds.R1.patientName' }],
              },
            ]
          : []
      )
    );
    await expect(run('hhr-pruebas', true)).rejects.toThrow('Composite index references');
    expect(cliMock.mock.calls.every(([, args]) => !isUpdate(args))).toBe(true);
  });
  it('rejects the retired project without making a gcloud call', async () => {
    await expect(run('hospital-hanga-roa', true)).rejects.toThrow('Usage:');
    expect(cliMock).not.toHaveBeenCalled();
  });
  it('stops after a rejected update instead of reporting acceptance or continuing', async () => {
    cliMock.mockImplementation((_program, args: string[]) => {
      if (isUpdate(args)) throw new Error('synthetic permission denial');
      return '[]';
    });
    await expect(run('hhr-pruebas', true)).rejects.toThrow('synthetic permission denial');
    expect(cliMock.mock.calls.filter(([, args]) => isUpdate(args))).toHaveLength(1);
  });
  it('is idempotent when every field policy and TTL is already configured', async () => {
    cliMock.mockImplementation((_program, args: string[]) =>
      JSON.stringify(
        args[2] === 'fields'
          ? policies.fieldOverrides.map(policy => ({
              name: `${prefix}${policy.collectionGroup}/fields/${policy.fieldPath}`,
              indexConfig: {},
            }))
          : args[2] === 'ttls'
            ? policies.fieldOverrides
                .filter(policy => 'ttl' in policy)
                .map(policy => ({
                  name: `${prefix}${policy.collectionGroup}/fields/${policy.fieldPath}`,
                  ttlConfig: { state: 'ACTIVE' },
                }))
            : []
      )
    );
    await run('hhr-pruebas', true);
    expect(cliMock.mock.calls.every(([, args]) => !isUpdate(args))).toBe(true);
  });
});
