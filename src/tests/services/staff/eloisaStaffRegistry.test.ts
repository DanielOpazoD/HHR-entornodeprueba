import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const { db } = vi.hoisted(() => ({ db: { current: null as unknown } }));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => false }));
vi.mock('@/services/storage/indexeddb/indexedDbCore', () => ({
  get hospitalDB() {
    return db.current;
  },
  ensureDbReady: async () => {},
}));
import { registerEloisaStaff, readEloisaStaff } from '@/services/staff/eloisaStaffRegistry';
import { inferNursingShifts } from '@/features/rayen-import/domain/inferNursingShifts';
const database = new Dexie('eloisa-staff-registry-test');
database.version(1).stores({ catalogs: 'id' });
db.current = database;
const activity = (author: string) => ({
  author,
  role: 'Enfermera',
  recordedAt: '2026-09-05T12:00:00',
});
beforeEach(async () => {
  await database.table('catalogs').clear();
});
afterAll(async () => {
  await database.delete();
});
describe('local staff discovery persistence', () => {
  it('requires review when an un-IDd short name can belong to either of two professionals', async () => {
    const observations = await registerEloisaStaff(
      [
        { author: 'Ana Soto Rojas', practitionerId: '8' },
        { author: 'Ana Soto Perez', practitionerId: '9' },
        { author: 'Ana Soto' },
      ].flatMap(person =>
        ['E1', 'E2'].map(encounterId => ({
          ...activity(person.author),
          ...person,
          source: 'evolution' as const,
          encounterId,
          authorIdentity: { firstGivenName: 'Ana', firstSurname: 'Soto' },
        }))
      )
    );
    const proposal = inferNursingShifts(observations, '2026-09-05', []);
    expect(proposal.day.ambiguous).toBe(true);
    expect(proposal.day.names).toEqual([]);
    expect(await readEloisaStaff()).toHaveLength(3);
  });
  it('groups source-supported spellings before inference without requiring manual registration', async () => {
    const observations = await registerEloisaStaff([
      {
        ...activity('Ana Soto Rojas'),
        practitionerId: '8',
        source: 'evolution' as const,
        encounterId: 'E1',
        authorIdentity: { firstGivenName: 'Ana', firstSurname: 'Soto' },
      },
      { ...activity('Ana Soto'), source: 'evolution' as const, encounterId: 'E2' },
    ]);
    for (const catalog of [[], ['Ana Soto']]) {
      const proposal = inferNursingShifts(observations, '2026-09-05', catalog);
      expect(proposal.day.names).toEqual(['Ana Soto Rojas']);
      expect(proposal.day.ambiguous).toBe(false);
      expect(proposal.day.candidates).toHaveLength(1);
    }
  });
  it('appends concurrent discoveries, survives readback and leaves manual catalogs intact', async () => {
    await database.table('catalogs').put({ id: 'nurses', list: ['Manual Persona'] });
    await Promise.all([
      registerEloisaStaff([activity('Ana Soto')]),
      registerEloisaStaff([activity('Berta Perez')]),
    ]);
    expect((await readEloisaStaff()).map(entry => entry.name)).toEqual(['Ana Soto', 'Berta Perez']);
    expect((await database.table('catalogs').get('nurses')).list).toEqual(['Manual Persona']);
    await registerEloisaStaff([activity('Ana Soto')]);
    expect(await readEloisaStaff()).toHaveLength(2);
  });
  it('propagates storage failure instead of reporting successful registration', async () => {
    const transaction = vi.spyOn(database, 'transaction').mockRejectedValueOnce(new Error('disk'));
    await expect(registerEloisaStaff([activity('Ana Soto')])).rejects.toThrow('disk');
    transaction.mockRestore();
  });
});
