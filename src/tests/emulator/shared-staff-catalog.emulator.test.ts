import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import { getActiveHospitalId } from '@/constants/firestorePaths';

let activeDb: unknown;
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { ready: Promise.resolve(), getDb: () => activeDb },
}));
import {
  publishSharedStaffCatalog,
  SHARED_STAFF_DOC,
} from '@/services/staff/sharedEloisaStaffCatalog';
import { mergeEloisaStaff } from '@/services/staff/eloisaStaffDiscovery';
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
    await env?.cleanup();
  });
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
});
