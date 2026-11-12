import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import { getActiveHospitalId } from '@/constants/firestorePaths';
let activeDb: unknown;
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { ready: Promise.resolve(), getDb: () => activeDb },
}));
import {
  saveNurseCatalogToFirestore,
  saveTensCatalogToFirestore,
  saveProfessionalsCatalogToFirestore,
} from '@/services/storage/firestore/firestoreCatalogService';
let env: RulesTestEnvironment;
const path = `hospitals/${getActiveHospitalId()}/settings/nurses`;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-n4c-concurrency',
    firestore: {
      ...resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST),
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
});
afterAll(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  activeDb = env
    .authenticatedContext('synthetic-a', {
      email: 'hospitalizados@hospitalhangaroa.cl',
      role: 'nurse_hospital',
    })
    .firestore({ ignoreUndefinedProperties: true });
  await env.withSecurityRulesDisabled(async c => {
    await setDoc(doc(c.firestore(), path), { list: ['Sintético Base'] });
  });
});
const save = (next: string[], base: string[]) =>
  Reflect.apply(saveNurseCatalogToFirestore, undefined, [next, base]);
const read = async () => {
  const reader = env
    .authenticatedContext('synthetic-reader', {
      email: 'hospitalizados@hospitalhangaroa.cl',
      role: 'nurse_hospital',
    })
    .firestore({ ignoreUndefinedProperties: true });
  return (await getDoc(doc(reader, path))).data()?.list;
};
it('preserves additions from two clients with the same old base', async () => {
  await save(['Sintético Base', 'Sintético Uno'], ['Sintético Base']);
  activeDb = env
    .authenticatedContext('synthetic-b', {
      email: 'hospitalizados@hospitalhangaroa.cl',
      role: 'nurse_hospital',
    })
    .firestore({ ignoreUndefinedProperties: true });
  await save(['Sintético Base', 'Sintético Dos'], ['Sintético Base']);
  expect(await read()).toEqual(['Sintético Base', 'Sintético Uno', 'Sintético Dos']);
});
it('single client save remains supported', async () => {
  await save(['Sintético Base', 'Sintético Uno'], ['Sintético Base']);
  expect(await read()).toEqual(['Sintético Base', 'Sintético Uno']);
});
it('does not resurrect a removed element when another client adds', async () => {
  await save([], ['Sintético Base']);
  await save(['Sintético Base', 'Sintético Dos'], ['Sintético Base']);
  expect(await read()).toEqual(['Sintético Dos']);
});
it('rejects rename after removal without writing the second change', async () => {
  await save([], ['Sintético Base']);
  await expect(save(['Sintético Renombrado'], ['Sintético Base'])).rejects.toThrow(
    'La lista cambió en otro equipo'
  );
  expect(await read()).toEqual([]);
});
it('preserves existing settings permissions', async () => {
  activeDb = env
    .authenticatedContext('synthetic-denied', {
      email: 'synthetic@example.invalid',
      role: 'viewer',
    })
    .firestore({ ignoreUndefinedProperties: true });
  await expect(save(['Sintético Dos'], ['Sintético Base'])).rejects.toThrow();
  expect(await read()).toEqual(['Sintético Base']);
});

it('TENS additions preserve both clients', async () => {
  await env.withSecurityRulesDisabled(async c => {
    await setDoc(doc(c.firestore(), path.replace('/nurses', '/tens')), { list: [] });
  });
  await saveTensCatalogToFirestore(['Sintético Uno'], []);
  await saveTensCatalogToFirestore(['Sintético Dos'], []);
  await env.withSecurityRulesDisabled(async c => {
    expect(
      (await getDoc(doc(c.firestore(), path.replace('/nurses', '/tens')))).data()?.list
    ).toEqual(['Sintético Uno', 'Sintético Dos']);
  });
});
it('professional edits preserve unrelated ids and reject conflicting specialty changes', async () => {
  const base = [
    {
      name: 'Sintético Uno',
      phone: '',
      rayenPractitionerId: 'synthetic-one',
      specialty: 'Pediatría',
    },
    {
      name: 'Sintético Dos',
      phone: '',
      rayenPractitionerId: 'synthetic-two',
      specialty: 'Pediatría',
    },
  ];
  const refPath = path.replace('/nurses', '/professionals_catalog');
  await env.withSecurityRulesDisabled(async c => {
    await setDoc(doc(c.firestore(), refPath), { list: base });
  });
  await saveProfessionalsCatalogToFirestore([{ ...base[0], specialty: 'Cirugía' }, base[1]], base);
  await saveProfessionalsCatalogToFirestore(
    [base[0], { ...base[1], specialty: 'Psiquiatría' }],
    base
  );
  await expect(
    saveProfessionalsCatalogToFirestore(
      [{ ...base[0], specialty: 'Medicina Interna' }, base[1]],
      base
    )
  ).rejects.toThrow('La lista cambió');
  await env.withSecurityRulesDisabled(async c => {
    expect(
      (await getDoc(doc(c.firestore(), refPath)))
        .data()
        ?.list.map((item: { specialty: string }) => item.specialty)
    ).toEqual(['Cirugía', 'Psiquiatría']);
  });
});

const seedNurses = async (data: object) =>
  env.withSecurityRulesDisabled(async c => {
    await setDoc(doc(c.firestore(), path), data);
  });
it('a first save on an empty or missing catalog stores what was written', async () => {
  // The editor never sends display examples as saved names: its saved base is empty.
  await seedNurses({ list: [] });
  await save(['Sintético Real'], []);
  expect(await read()).toEqual(['Sintético Real']);

  await env.clearFirestore();
  await save(['Sintético Nuevo'], []);
  expect(await read()).toEqual(['Sintético Nuevo']);
});
it('renaming a row replaces every saved text it stands for and keeps other changes', async () => {
  await seedNurses({ list: ['Sintético Uno', 'sintético uno', 'Sintético Otro'] });
  await save(['Sintético Nuevo'], ['Sintético Uno', 'sintético uno']);
  expect(await read()).toEqual(['Sintético Nuevo', 'Sintético Otro']);
});
it('renaming in the middle keeps the order and removing the only row leaves a real empty list', async () => {
  await seedNurses({ list: ['Sintético Uno', 'Sintético Dos', 'Sintético Tres'] });
  const base = ['Sintético Uno', 'Sintético Dos', 'Sintético Tres'];
  await save(['Sintético Uno', 'Sintético Nuevo', 'Sintético Tres'], base);
  expect(await read()).toEqual(['Sintético Uno', 'Sintético Nuevo', 'Sintético Tres']);

  await seedNurses({ list: ['Sintético Uno'] });
  await save([], ['Sintético Uno']);
  expect(await read()).toEqual([]);
});

// «Ana Pena» and «Ana Peña» are different saved texts: different people for the save.
const asClient = (id: string) => {
  activeDb = env
    .authenticatedContext(id, {
      email: 'hospitalizados@hospitalhangaroa.cl',
      role: 'nurse_hospital',
    })
    .firestore({ ignoreUndefinedProperties: true });
};
it('adding «Ana Peña» next to a saved «Ana Pena» keeps both', async () => {
  await seedNurses({ list: ['Ana Pena'] });
  asClient('synthetic-b');
  await save(['Ana Pena', 'Ana Peña'], ['Ana Pena']);
  expect(await read()).toEqual(['Ana Pena', 'Ana Peña']);
});
it.each([
  ['removing', [] as string[]],
  ['renaming', ['Ana Nueva']],
])('%s «Ana Pena» from an old base never removes «Ana Peña»', async (_action, next) => {
  await seedNurses({ list: ['Ana Pena'] });
  asClient('synthetic-b');
  await save(['Ana Pena', 'Ana Peña'], ['Ana Pena']);
  asClient('synthetic-a');
  await save(next, ['Ana Pena']);
  expect(await read()).toEqual([...next, 'Ana Peña']);
});
