import { expect, test, type Page } from '@playwright/test';
import { buildCanonicalE2ERecord } from './fixtures/auth';
import {
  first,
  second,
  privateDay,
  privateNote,
  sharedComputerEmulators,
  login,
} from './fixtures/sharedComputerEmulators';

async function activateFirst(page: Page) {
  await page.goto('/');
  await page.getByLabel('Usuario', { exact: true }).fill(first.rut);
  await page.getByLabel('Contraseña', { exact: true }).fill('22222222');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByText('Primer ingreso: cambia tu clave')).toBeVisible();
  await expect(page.getByTestId('authenticated-user-menu-button')).not.toBeVisible();
  await page.getByLabel('Correo de recuperación').fill('a@example.invalid');
  await page.getByLabel('Elige tu clave personal').fill(first.password);
  await page.getByLabel('Repite tu nueva clave').fill(first.password);
  await page.getByRole('button', { name: 'Establecer clave e ingresar' }).click();
  await expect(page.getByTestId('authenticated-user-menu-button')).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Navegación principal HHR' })
      .getByText(first.name, { exact: true })
  ).toBeVisible();
}

async function logout(page: Page) {
  await page.getByTestId('authenticated-user-menu-button').click();
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
}

async function hospitalDate(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/utils/dateCoreUtils.ts';
    return (await import(path)).getTodayISO() as string;
  });
}

test('pending A sets a private password, works, hands the computer to B and returns to her retained work', async ({
  page,
}) => {
  const emulator = await sharedComputerEmulators(page);
  try {
    await page.clock.install();
    await activateFirst(page);
    expect(
      (await emulator.firestore.doc(`hhr_account_access/${emulator.a}`).get()).data()?.status
    ).toBe('active');
    const date = await hospitalDate(page);
    const common = buildCanonicalE2ERecord(date);
    await emulator.firestore.doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(common);
    await page.goto(`/nursing-handoff?date=${date}`);
    await page.getByTestId('handoff-shift-day-button').click();
    const notes = page.getByRole('textbox', { name: 'Novedades & Pendientes' });
    await expect(notes).toBeEditable();
    await notes.fill('SYNTHETIC CONFIRMED WORK A');
    await notes.blur();
    await page.clock.runFor(2000);
    await expect
      .poll(
        async () =>
          (await emulator.firestore.doc(`hospitals/hanga_roa/dailyRecords/${date}`).get()).data()
            ?.handoffNovedadesDayShift
      )
      .toBe('SYNTHETIC CONFIRMED WORK A');
    // Deterministic unsent fixture: real IndexedDB, owner, contract and canonical logout.
    // This private local day is intentionally absent remotely; B may still read shared hospital days.
    const taskId = await page.evaluate(
      async ({ uid, record, note }) => {
        const path = '/src/services/storage/indexeddb/indexedDbCore.ts';
        const { hospitalDB } = await import(path);
        await hospitalDB.dailyRecords.put(record);
        return hospitalDB.syncQueue.add({
          type: 'UPDATE_DAILY_RECORD',
          key: `daily:${record.date}`,
          payload: { ...record, handoffNovedadesDayShift: note },
          opId: 'synthetic-shared-handoff',
          ownerKey: `user:${uid}`,
          timestamp: Date.now(),
          retryCount: 0,
          status: 'CONFLICT',
          lastErrorCategory: 'conflict',
          syncContract: {
            changedPaths: ['handoffNovedadesDayShift'],
            expectedVersion: record.lastUpdated,
            mutationId: 'synthetic-shared-mutation',
          },
        });
      },
      {
        uid: emulator.a,
        record: buildCanonicalE2ERecord(privateDay, { handoffNovedadesDayShift: privateNote }),
        note: privateNote,
      }
    );
    await logout(page);
    await expect(page.getByRole('button', { name: 'Descargar copia y salir' })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar copia y salir' }).click();
    expect((await download).suggestedFilename()).toMatch(/^hhr-envio-local-/);
    await expect(page.getByTestId('login-google-button')).toBeVisible();
    await login(page, second);
    const notice = page.getByRole('status').filter({ hasText: 'Hay una entrega de turno' });
    await expect(notice).toContainText(first.name);
    await expect(notice).not.toContainText(privateNote);
    await expect(page.locator('body')).not.toContainText(privateNote);
    const isolation = await page.evaluate(
      async ({ id, date }) => {
        const storage = '/src/services/storage/indexeddb/indexedDbCore.ts';
        const queue = '/src/services/storage/sync/publicSyncQueue.ts';
        const { hospitalDB } = await import(storage);
        return {
          day: (await hospitalDB.dailyRecords.get(date)) ?? null,
          visible: await (await import(queue)).listRecentSyncQueueOperations(50),
          retained: await hospitalDB.syncQueue.get(id),
        };
      },
      { id: taskId, date: privateDay }
    );
    expect(isolation.day).toBeNull();
    expect(isolation.visible).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: taskId })])
    );
    expect(isolation.retained).toMatchObject({
      ownerKey: `user:${emulator.a}`,
      payload: { handoffNovedadesDayShift: privateNote },
      projectionReleased: true,
    });
    await logout(page);
    await expect(page.getByTestId('login-google-button')).toBeVisible();
    await login(page, first);
    await expect
      .poll(() =>
        page.evaluate(async id => {
          const path = '/src/services/storage/sync/publicSyncQueue.ts';
          return (await (await import(path)).listRecentSyncQueueOperations(50)).some(
            (task: { id: number }) => task.id === id
          );
        }, taskId)
      )
      .toBe(true);
    expect(
      await page.evaluate(async id => {
        const path = '/src/services/storage/indexeddb/indexedDbCore.ts';
        return (await (await import(path)).hospitalDB.syncQueue.get(id))?.payload
          .handoffNovedadesDayShift;
      }, taskId)
    ).toBe(privateNote);
    expect(
      emulator.failures.filter(name => !name.startsWith('saveDailyRecordWithClinicalAuthority:'))
    ).toEqual([]);
  } finally {
    await emulator.close();
  }
});

test('one hour without activity closes the active nurse session with the controlled browser clock', async ({
  page,
}) => {
  const emulator = await sharedComputerEmulators(page);
  try {
    await page.clock.install();
    await page.goto('/');
    await login(page, second);
    await page.clock.fastForward(59 * 60 * 1000);
    await expect(
      page
        .getByRole('navigation', { name: 'Navegación principal HHR' })
        .getByText(second.name, { exact: true })
    ).toBeVisible();
    await page.clock.fastForward(61_000);
    // The monitor gives queued cross-tab activity one second of grace.
    await page.clock.runFor(1100);
    await expect(page.getByTestId('login-google-button')).toBeVisible();
    await expect(page.getByTestId('authenticated-user-menu-button')).not.toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('hhr_session_owner_v1')))
      .toBeNull();
  } finally {
    await emulator.close();
  }
});

test('an Auth-emulated nurse synchronizes and replays previous-day CUDYR through the real client and authority', async ({
  page,
}) => {
  const emulator = await sharedComputerEmulators(page);
  try {
    await page.goto('/');
    await login(page, second);
    const date = await hospitalDate(page);
    const previous = await page.evaluate(async date => {
      const path = '/src/utils/clinicalDayUtils.ts';
      return (await import(path)).getPreviousDay(date) as string;
    }, date);
    const policy = {
      schemaVersion: 2,
      mode: 'preview',
      clinicalBatchMode: 'enforced',
      revision: 1,
    };
    const version = new Date(Date.now() - 10000).toISOString();
    const record = (day: string) => ({
      date: day,
      dateTimestamp: Date.now(),
      lastUpdated: version,
      beds: {
        R1: {
          bedId: 'R1',
          patientName: 'SYNTHETIC CUDYR PATIENT',
          documentType: 'Pasaporte',
          rut: 'SYNTHETIC-PASSPORT',
          admissionDate: previous,
          admissionTime: '08:00',
          clinicalEpisodeId: 'synthetic-episode',
          isBlocked: false,
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      meta: { revision: 1 },
    });
    const root = 'hospitals/hanga_roa';
    await emulator.firestore.doc(`${root}/settings/rayenImportPolicy`).set(policy);
    await emulator.firestore.doc(`${root}/dailyRecords/${date}`).set({
      ...record(date),
      rayenSyncHistory: [
        {
          id: 'synthetic-shared-run',
          sourceDate: date,
          startedAt: new Date().toISOString(),
          status: 'applied',
          by: second.name,
          policy,
        },
      ],
    });
    await emulator.firestore.doc(`${root}/dailyRecords/${previous}`).set(record(previous));
    const payload = {
      date: previous,
      authorityDate: date,
      runId: 'synthetic-shared-run',
      mutationId: 'synthetic-shared-cudyr',
      expectedLastUpdated: version,
      baseRevision: 1,
      fieldContractVersion: 2,
      mode: 'enforced',
      patches: [
        {
          bedId: 'R1',
          clinicalEpisodeId: 'synthetic-episode',
          fields: { evaluationScores: { cudyr: { category: 'C2', source: 'Eloísa' } } },
        },
      ],
    };
    const call = () =>
      page.evaluate(async data => {
        const path = '/src/features/rayen-import/bridge/rayenClinicalEnrichmentBatchClient.ts';
        return (await import(path)).callRayenClinicalEnrichmentBatch(data);
      }, payload);
    expect(await call()).toMatchObject({ success: true, authorityStatus: 'ok' });
    const confirmed = (
      await emulator.firestore.doc(`${root}/dailyRecords/${previous}`).get()
    ).data();
    expect(confirmed?.beds.R1.evaluationScores.cudyr.category).toBe('C2');
    expect(await call()).toMatchObject({ success: true, authorityStatus: 'idempotent' });
    expect((await emulator.firestore.doc(`${root}/dailyRecords/${previous}`).get()).data()).toEqual(
      confirmed
    );
    expect(emulator.failures).toEqual([]);
  } finally {
    await emulator.close();
  }
});
