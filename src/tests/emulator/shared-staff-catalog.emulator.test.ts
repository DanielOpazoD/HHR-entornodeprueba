import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import type { StaffObservation } from '@/services/staff/eloisaStaffIdentity';
import { mergeStaffCatalog } from '@/services/staff/eloisaStaffIdentity';
import '../../../extension/fichamedico-history-read-model.js';

let activeDb: unknown;
let localDb: Dexie;
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
vi.mock('@/services/storage/indexeddb/indexedDbCore', () => ({
  get hospitalDB() {
    return localDb;
  },
  ensureDbReady: async () => {},
}));
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { ready: Promise.resolve(), getDb: () => activeDb },
}));
import {
  publishSharedStaffCatalog,
  SHARED_STAFF_DOC,
} from '@/services/staff/sharedEloisaStaffCatalog';
import { mergeEloisaStaff } from '@/services/staff/eloisaStaffDiscovery';
import {
  readEloisaStaff,
  registerEloisaStaff,
  subscribeEloisaStaff,
} from '@/services/staff/eloisaStaffRegistry';
const openLocalCatalog = (name: string) => {
  const database = new Dexie(name);
  database.version(1).stores({ catalogs: 'id' });
  return database;
};
const project = (
  globalThis as typeof globalThis & {
    HhrFichaMedicoHistoryReadModel: {
      project: (payload: unknown) => { nursingActivity: StaffObservation[] };
    };
  }
).HhrFichaMedicoHistoryReadModel.project;
const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
run('shared staff catalog emulator', () => {
  let env: RulesTestEnvironment;
  const path = (id: string) => `hospitals/${getActiveHospitalId()}/settings/${id}`;
  beforeAll(async () => {
    const address = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
    env = await initializeTestEnvironment({
      projectId: 'demo-hhr-staff-catalog',
      firestore: { ...address, rules: readFileSync('firestore.rules', 'utf8') },
    });
  });
  beforeEach(async () => {
    await env.clearFirestore();
    localDb = openLocalCatalog('staff-pipeline-emulator');
    await localDb.table('catalogs').clear();
    activeDb = env
      .authenticatedContext('nurse', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), path('nurses')), {
        list: ['Personal Anterior'],
        nurses: ['Personal Anterior'],
      });
      await setDoc(doc(context.firestore(), path('tens')), {
        list: ['Tecnico Anterior'],
        tens: ['Tecnico Anterior'],
      });
    });
  });
  afterAll(async () => {
    await localDb?.delete();
    await env?.cleanup();
  });
  afterEach(() => localDb?.close());
  const names = (author: string, role = 'Enfermera') =>
    mergeEloisaStaff([], [{ author, role, recordedAt: '2026-09-01T12:00:00' }]);
  it('merges simultaneous discoveries atomically and keeps automatic provenance across retries', async () => {
    await Promise.all([
      publishSharedStaffCatalog(names('Ana Soto')),
      publishSharedStaffCatalog(names('Berta Perez', 'TENS')),
    ]);
    const reader = env
      .authenticatedContext('reader', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
    expect((await getDoc(doc(reader, path('nurses')))).data()?.list).toEqual([
      'Personal Anterior',
      'Ana Soto',
    ]);
    expect((await getDoc(doc(reader, path('tens')))).data()?.list).toEqual([
      'Tecnico Anterior',
      'Berta Perez',
    ]);
    const previous = (await getDoc(doc(reader, path(SHARED_STAFF_DOC)))).data();
    await publishSharedStaffCatalog(names('Ana Soto'));
    expect((await getDoc(doc(reader, path(SHARED_STAFF_DOC)))).data()).toEqual(previous);
    expect(
      previous?.list.every(
        (entry: { manuallyCatalogued: boolean }) => entry.manuallyCatalogued === false
      )
    ).toBe(true);
  });
  it('does not bypass authentication or existing settings write permissions', async () => {
    activeDb = env.unauthenticatedContext().firestore();
    await expect(publishSharedStaffCatalog(names('Sin Acceso'))).rejects.toThrow();
  });
  it('carries source IDs through discovery, shared publication and reopened local storage', async () => {
    const payload = [
      {
        publishDatetime: '2026-09-05T12:00:00',
        evolutionResume: [
          {
            HCP_FGN: 'Ana',
            HCP_FFN: 'Soto',
            HCP_SFN: 'Rojas',
            HCPR_NAME: 'Enfermera',
            authorHealthCarePractitionerId: 'staff-a',
          },
          { HCP_NAME: 'Ana Soto', HCPR_NAME: 'Enfermera', healthCarePractitionerId: 'staff-a' },
          { HCP_NAME: 'Ana Soto Rojas', HCPR_NAME: 'TENS', HCP_ID: 'staff-t' },
        ],
      },
    ];
    const original = structuredClone(payload);
    const observations = project(payload).nursingActivity;
    expect(observations.map(row => row.practitionerId)).toEqual(['staff-a', 'staff-a', 'staff-t']);
    const registered = await registerEloisaStaff(observations);
    expect(registered).toHaveLength(3);
    registered.forEach(row =>
      expect(row).toEqual(
        expect.objectContaining({
          resolvedStaffIdentity: expect.objectContaining({
            name: 'Ana Soto Rojas',
            catalogMatched: false,
          }),
        })
      )
    );
    const confirmed = await readEloisaStaff();
    expect(confirmed).toEqual([
      expect.objectContaining({
        key: 'nurse:id:staff-a',
        practitionerId: 'staff-a',
        role: 'nurse',
        name: 'Ana Soto Rojas',
        aliases: expect.arrayContaining(['Ana Soto']),
      }),
      expect.objectContaining({
        key: 'tens:id:staff-t',
        practitionerId: 'staff-t',
        role: 'tens',
        name: 'Ana Soto Rojas',
      }),
    ]);
    const reader = env
      .authenticatedContext('reader', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
    const sharedRef = doc(reader, path(SHARED_STAFF_DOC));
    const remote = (await getDoc(sharedRef)).data();
    expect(remote?.list).toEqual(confirmed);
    expect((await getDoc(doc(reader, path('nurses')))).data()?.list).toEqual(
      mergeStaffCatalog(['Personal Anterior'], confirmed, 'nurse')
    );
    expect((await getDoc(doc(reader, path('tens')))).data()?.list).toEqual(
      mergeStaffCatalog(['Tecnico Anterior'], confirmed, 'tens')
    );
    localDb.close();
    localDb = openLocalCatalog('staff-pipeline-emulator');
    expect(await readEloisaStaff()).toEqual(confirmed);
    await registerEloisaStaff(observations);
    expect((await getDoc(sharedRef)).data()).toEqual(remote);
    expect(await readEloisaStaff()).toEqual(confirmed);
    expect(confirmed.every(entry => entry.manuallyCatalogued === false)).toBe(true);
    expect(payload).toEqual(original);
    localDb.close();
    localDb = openLocalCatalog('staff-pipeline-fresh-reader');
    await localDb.table('catalogs').clear();
    expect(await readEloisaStaff()).toEqual([]);
    const next = vi.fn(),
      error = vi.fn();
    const unsubscribe = subscribeEloisaStaff(next, error, true);
    try {
      // The shared snapshot reaches the local catalog through a lazy import, a Firestore
      // listener and an IndexedDB write; loaded CI runners can exceed waitFor's 1 s default.
      await vi.waitFor(() => expect(next).toHaveBeenLastCalledWith(confirmed), {
        timeout: 10_000,
      });
      expect(await readEloisaStaff()).toEqual(confirmed);
      expect(error).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
      await localDb.delete();
    }
  });
  it('preserves separate source identities when a later discovery makes a short alias ambiguous', async () => {
    const observation = (author: string, practitionerId?: string): StaffObservation => ({
      author,
      practitionerId,
      role: 'Enfermera',
      recordedAt: '2026-09-05T12:00:00',
      authorIdentity: { firstGivenName: 'Ana', firstSurname: 'Soto' },
    });
    await registerEloisaStaff([observation('Ana Soto Rojas', 'staff-a')]);
    const unambiguous = await registerEloisaStaff([observation('Ana Soto')]);
    expect(unambiguous[0]).toEqual(
      expect.objectContaining({
        resolvedStaffIdentity: expect.objectContaining({
          key: 'nurse:id:staff-a',
          name: 'Ana Soto Rojas',
        }),
      })
    );
    const second = observation('Ana Soto Perez', 'staff-b');
    await registerEloisaStaff([second]);
    const short = await registerEloisaStaff([observation('Ana Soto')]);
    expect(short[0]).toEqual(expect.objectContaining({ resolvedStaffIdentity: undefined }));
    const entries = await readEloisaStaff();
    expect(entries).toHaveLength(3);
    expect(
      entries.filter(entry => entry.practitionerId).map(entry => entry.practitionerId)
    ).toEqual(['staff-a', 'staff-b']);
    await registerEloisaStaff([second]);
    expect(await readEloisaStaff()).toEqual(entries);
  });
  describe.each([
    { role: 'nurse', doc: 'nurses', sourceRole: 'Enfermera' },
    { role: 'tens', doc: 'tens', sourceRole: 'TENS' },
  ] as const)('staff name identity ($role)', ({ role, doc: listDoc, sourceRole }) => {
    const stored = async (id: string) => (await getDoc(doc(activeDb as never, path(id)))).data();
    const observe = (author: string, practitionerId?: string): StaffObservation => ({
      author,
      practitionerId,
      role: sourceRole,
      recordedAt: '2026-11-12T12:00:00',
    });
    const seed = (id: string, data: Record<string, unknown>) =>
      env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), path(id)), data));
    const save = async (next: string[], base: string[]) => {
      const service = await import('@/services/storage/firestore/firestoreCatalogService');
      const saveList =
        role === 'nurse' ? service.saveNurseCatalogToFirestore : service.saveTensCatalogToFirestore;
      return saveList(next, base);
    };

    it.each([
      ['Françoise Soto', 'Francoise Soto', false],
      ['Ana Côte', 'Ana Cote', false],
      ['Agnès Soto', 'Agnes Soto', false],
      ['Joëlle Soto', 'Joelle Soto', true],
      ['José Núñez', 'Jose Nunez', true],
      ['Ana Peña', 'Ana Pena', true],
    ] as const)(
      'a manual save keeps %s and %s apart only for a cedilla, grave or circumflex',
      async (rich, plain, samePerson) => {
        for (const [first, second] of [
          [rich, plain],
          [plain, rich],
        ]) {
          await seed(listDoc, { list: [first] });
          await save([first, second], [first]);
          expect((await stored(listDoc))?.list).toEqual(samePerson ? [rich] : [first, second]);
        }
      }
    );

    it('adding a cedilla-less alias of the same Eloísa ID keeps one entry, spelled as saved', async () => {
      await seed(listDoc, { list: ['Françoise Soto'] });
      await seed(SHARED_STAFF_DOC, {
        list: mergeEloisaStaff(
          [],
          [observe('Françoise Soto', 'syn1'), observe('Francoise Soto', 'syn1')]
        ),
      });
      await save(['Françoise Soto', 'Francoise Soto'], ['Françoise Soto']);
      expect((await stored(listDoc))?.list).toEqual(['Françoise Soto']);
    });

    it('two Eloísa IDs that differ only in a cedilla stay two entries', async () => {
      await seed(listDoc, { list: ['Ana França'] });
      await seed(SHARED_STAFF_DOC, {
        list: mergeEloisaStaff([], [observe('Ana Franca', 'syn1'), observe('Ana França', 'syn2')]),
      });
      await save(['Ana França', 'Ana Franca'], ['Ana França']);
      expect((await stored(listDoc))?.list).toEqual(['Ana França', 'Ana Franca']);
    });

    it('Eloísa cannot strip the cedilla from a catalogued name of the same ID', async () => {
      await seed(listDoc, { list: ['Françoise Soto'] });
      const [first] = await registerEloisaStaff([
        observe('Françoise Soto', 'syn1'),
        observe('Francoise Soto', 'syn1'),
      ]);
      expect((await stored(listDoc))?.list).toEqual(['Françoise Soto']);
      expect(first).toEqual(
        expect.objectContaining({
          resolvedStaffIdentity: expect.objectContaining({
            name: 'Françoise Soto',
            catalogMatched: true,
          }),
        })
      );
    });

    it('repeating an observation without ID over an identity saved before keeps one identity', async () => {
      // Saved by a version that folded the cedilla into the key.
      const saved = {
        key: `${role}:name:ana franca`,
        role,
        name: 'Ana França',
        aliases: ['Ana França'],
        manuallyCatalogued: false,
      };
      await seed(SHARED_STAFF_DOC, { list: [saved] });
      await seed(listDoc, { list: ['Ana França'] });
      const [result] = await registerEloisaStaff([observe('Ana França')]);
      expect((await stored(SHARED_STAFF_DOC))?.list).toEqual([saved]);
      expect(await readEloisaStaff()).toEqual([saved]);
      expect(result).toEqual(
        expect.objectContaining({
          resolvedStaffIdentity: expect.objectContaining({ key: saved.key }),
        })
      );
      expect((await stored(listDoc))?.list).toEqual(['Ana França']);
    });

    it('a new name without ID that differs by a cedilla is not absorbed by an older identity', async () => {
      // Saved by a version that folded the cedilla into the key.
      const legacy = {
        key: `${role}:name:ana franca`,
        role,
        name: 'Ana França',
        aliases: ['Ana França'],
        manuallyCatalogued: true,
      };
      await seed(listDoc, { list: ['Ana França'] });
      await seed(SHARED_STAFF_DOC, { list: [legacy] });
      const [result] = await registerEloisaStaff([observe('Ana Franca')]);
      expect(new Set((await stored(listDoc))?.list)).toEqual(new Set(['Ana França', 'Ana Franca']));
      const local = await readEloisaStaff();
      expect(local.map(entry => entry.name).sort()).toEqual(['Ana Franca', 'Ana França']);
      expect(local.find(entry => entry.key === legacy.key)).toEqual(legacy);
      expect(result).toEqual(
        expect.objectContaining({
          resolvedStaffIdentity: expect.objectContaining({ name: 'Ana Franca' }),
        })
      );
      const [again] = await registerEloisaStaff([observe('Ana França')]);
      expect(again).toEqual(
        expect.objectContaining({
          resolvedStaffIdentity: expect.objectContaining({ key: legacy.key }),
        })
      );
      expect(await readEloisaStaff()).toHaveLength(2);
    });

    it('two Eloísa IDs whose names fold alike stay two entries of the role catalog', async () => {
      await seed(listDoc, { list: ['Ana Pena'] });
      await registerEloisaStaff([observe('Ana Pena', 'syn1'), observe('Ana Peña', 'syn2')]);
      expect(new Set((await stored(listDoc))?.list)).toEqual(new Set(['Ana Pena', 'Ana Peña']));
      expect(await readEloisaStaff()).toHaveLength(2);
    });

    it.each([
      ['Francoise Martín', 'Françoise Martin'],
      ['Françoise Martin', 'Francoise Martín'],
    ])('Eloísa keeps the saved spelling of the same ID: batch %s, %s', async (first, second) => {
      await seed(listDoc, { list: ['Françoise Martin'] });
      await registerEloisaStaff([observe(first, 'syn1'), observe(second, 'syn1')]);
      expect((await stored(listDoc))?.list).toEqual(['Françoise Martin']);
      expect((await readEloisaStaff()).map(entry => entry.name)).toEqual(['Françoise Martin']);
    });

    it('a signature without ID that two Eloísa people share adds no third entry or option', async () => {
      const names = ['Lía Pena', 'Lía Peña'];
      await seed(listDoc, { list: [] });
      await registerEloisaStaff(names.map((name, index) => observe(name, `syn${index}`)));
      expect(new Set((await stored(listDoc))?.list)).toEqual(new Set(names));
      const [event] = await registerEloisaStaff([observe('Lia Pena')]);
      expect(event).toEqual(expect.objectContaining({ staffNameAmbiguous: true }));
      const list = ((await stored(listDoc))?.list ?? []) as string[];
      expect(new Set(list)).toEqual(new Set(names));
      const { buildResolvedStaffSelectionOptions } =
        await import('@/services/staff/staffSelectionPresentation');
      const options = buildResolvedStaffSelectionOptions(list, [], await readEloisaStaff(), role);
      expect(new Set(options)).toEqual(new Set(['Vacante', ...names]));
    });

    /** A shift proposal from one run, against the roster the importer had before it. */
    const proposeAgainstRoster = async (
      activity: Array<StaffObservation & { encounterId?: string }>
    ) => {
      const { savedStaffRows } = await import('@/services/staff/eloisaStaffIdentity');
      const roster = savedStaffRows(
        ((await stored(listDoc))?.list ?? []) as string[],
        await readEloisaStaff(),
        role
      );
      const { collectClinicalFillStaffing } =
        await import('@/features/rayen-import/domain/clinicalFillStaffing');
      const { proposal, error } = await collectClinicalFillStaffing(
        activity.map(observation => ({
          ...observation,
          source: 'vital-signs' as const,
          encounterId: observation.encounterId ?? 'syn-encounter',
        })),
        '2026-11-12',
        {
          registerStaff: registerEloisaStaff,
          nurseCatalog: role === 'nurse' ? roster : [],
          tensCatalog: role === 'tens' ? roster : [],
        }
      );
      expect(error).toBeUndefined();
      return proposal;
    };
    const twice = (observation: StaffObservation) =>
      ['syn-a', 'syn-b'].map(encounterId => ({ ...observation, encounterId }));

    it('a colleague with another ID first seen in this run is offered, not taken as synchronized', async () => {
      await seed(listDoc, { list: ['Luz Pena'] });
      await registerEloisaStaff([observe('Luz Pena', 'syn1')]);
      const proposal = await proposeAgainstRoster(twice(observe('Luz Peña', 'syn2')));
      const { reconcileNursingShiftProposal, buildNursingShiftProposalPatch } =
        await import('@/features/rayen-import/domain/applyNursingShiftProposal');
      const slot = role === 'nurse' ? 'nursesDayShift' : 'tensDayShift';
      const record = { date: '2026-11-12', beds: {}, [slot]: ['Luz Pena'] };
      const reviewed = reconcileNursingShiftProposal(record as never, proposal);
      expect(reviewed[role === 'nurse' ? 'day' : 'tensDay']?.alreadyAssigned ?? []).toEqual([]);
      const patch = buildNursingShiftProposalPatch(record as never, reviewed);
      expect(patch?.[slot]?.slice(0, 2)).toEqual(['Luz Pena', 'Luz Peña']);
    });

    it('one person first seen in this run with a ñ is still the saved «Ana Pena», as on main', async () => {
      await seed(listDoc, { list: ['Ana Pena'] });
      const proposal = await proposeAgainstRoster(twice(observe('Ana Peña', 'syn1')));
      const { reconcileNursingShiftProposal, buildNursingShiftProposalPatch } =
        await import('@/features/rayen-import/domain/applyNursingShiftProposal');
      const slot = role === 'nurse' ? 'nursesDayShift' : 'tensDayShift';
      const record = { date: '2026-11-12', beds: {}, [slot]: ['Ana Pena'] };
      const reviewed = reconcileNursingShiftProposal(record as never, proposal);
      expect(reviewed[role === 'nurse' ? 'day' : 'tensDay']?.alreadyAssigned).toEqual(['Ana Peña']);
      expect(buildNursingShiftProposalPatch(record as never, reviewed)).toBeNull();
    });

    it('the handover window names the person the source ID accredits', async () => {
      await seed(listDoc, { list: ['Luz Pena', 'Luz Peña'] });
      await registerEloisaStaff([observe('Luz Pena', 'syn1'), observe('Luz Peña', 'syn2')]);
      const proposal = await proposeAgainstRoster([
        { ...observe('Luz Pena', 'syn2'), recordedAt: '2026-11-12T08:30:00' },
      ]);
      expect(
        proposal[role === 'nurse' ? 'day' : 'tensDay']?.ignoredBoundaryEvidence?.map(
          entry => entry.name
        )
      ).toEqual(['Luz Peña']);
    });

    it('an activity without ID whose name two Eloísa people share proposes nobody for the shift', async () => {
      await seed(listDoc, { list: ['Ana Peña'] });
      await registerEloisaStaff([observe('Ana Pena', 'syn1'), observe('Ana Peña', 'syn2')]);
      const { collectClinicalFillStaffing } =
        await import('@/features/rayen-import/domain/clinicalFillStaffing');
      const { reconcileNursingShiftProposal, buildNursingShiftProposalPatch } =
        await import('@/features/rayen-import/domain/applyNursingShiftProposal');
      const catalog = ((await stored(listDoc))?.list ?? []) as string[];
      const { proposal, error } = await collectClinicalFillStaffing(
        [{ ...observe('Ana Pena'), source: 'vital-signs', encounterId: 'syn-encounter' }],
        '2026-11-12',
        {
          registerStaff: registerEloisaStaff,
          nurseCatalog: role === 'nurse' ? catalog : [],
          tensCatalog: role === 'tens' ? catalog : [],
        }
      );
      expect(error).toBeUndefined();
      // Nobody is named and the shift is left for a person to review.
      const shift = role === 'nurse' ? proposal?.day : proposal?.tensDay;
      expect(shift).toEqual(expect.objectContaining({ names: [], ambiguous: true }));
      const record = {
        date: '2026-11-12',
        beds: {},
        nurses: [],
        nursesDayShift: [],
        nursesNightShift: [],
        tensDayShift: [],
        tensNightShift: [],
      };
      const review = reconcileNursingShiftProposal(record as never, proposal);
      expect(buildNursingShiftProposalPatch(record as never, review)).toBeNull();
    });
  });
  it('does not report a failed shared publication as success and converges when retried', async () => {
    const authenticatedDb = activeDb;
    activeDb = env.unauthenticatedContext().firestore();
    const observations = [
      {
        author: 'Nueva Persona',
        role: 'TENS',
        recordedAt: '2026-09-05T12:00:00',
        practitionerId: 'staff-new',
      },
    ];
    await expect(registerEloisaStaff(observations)).rejects.toThrow();
    expect(await readEloisaStaff()).toHaveLength(1);
    activeDb = authenticatedDb;
    await registerEloisaStaff(observations);
    await registerEloisaStaff(observations);
    const reader = env
      .authenticatedContext('reader', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
    expect((await getDoc(doc(reader, path(SHARED_STAFF_DOC)))).data()?.list).toEqual(
      await readEloisaStaff()
    );
    expect((await getDoc(doc(reader, path('tens')))).data()?.list).toEqual([
      'Tecnico Anterior',
      'Nueva Persona',
    ]);
  });
});
