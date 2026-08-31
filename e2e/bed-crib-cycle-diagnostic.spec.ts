/**
 * Diagnóstico del ciclo cama–cuna (incidente activo 2026-08-30).
 *
 * Mide, con un reloj de página y sin sleeps, las fases observables del ciclo
 * crear → editar → limpiar → recargar → recrear usando la autoridad remota
 * interceptada (fixtures del PR #252). Cada llamada al callable se libera
 * explícitamente desde el test, así que toda espera medida es causal, no de reloj.
 *
 * Eventos registrados (vocabulario del dossier, commandId = mutationId del
 * syncContract interceptado; nunca datos clínicos):
 *   action_clicked, projection_visible, callable_started, server_commit,
 *   ack_received, indexeddb_committed (espejo local durable), ui_converged.
 *
 * La fase mutation_turn no es visible desde fuera; se demuestra causalmente:
 * el escenario T3 retiene el ACK de una escritura no relacionada y verifica que
 * projection_visible del CREATE queda bloqueado exactamente hasta ese ACK.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import {
  installDailyRecordAuthorityRoute,
  type DailyRecordAuthorityRouteController,
} from './fixtures/dailyRecordAuthorityRoute';

const E2E_DATE = process.env.E2E_FIXED_DATE ?? '2026-02-20';
const PARENT_EPISODE_ID = 'diag-parent-episode';
const CRIB_EPISODE_ID = 'diag-crib-episode';
const SECOND_EPISODE_ID = 'diag-second-episode';
const PROJECTION_BUDGET_MS = 200;

const TIMELINE_DIR = path.join('reports', 'diagnostic');
const timeline: Array<Record<string, unknown>> = [];
const mark = (scenario: string, event: string, extra: Record<string, unknown> = {}) => {
  timeline.push({ scenario, event, tWallMs: Date.now(), ...extra });
};

test.afterAll(() => {
  fs.mkdirSync(TIMELINE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(TIMELINE_DIR, 'bed-crib-cycle-timeline.json'),
    JSON.stringify(timeline, null, 2)
  );
});

const buildParentPatient = () => ({
  id: 'R1',
  bedId: 'R1',
  patientName: 'Paciente Ciclo Cuna',
  firstName: 'Paciente',
  lastName: 'Ciclo',
  secondLastName: 'Cuna',
  rut: '11.111.111-1',
  clinicalEpisodeId: PARENT_EPISODE_ID,
  firstSeenDate: E2E_DATE,
  admissionDate: E2E_DATE,
  admissionTime: '08:00',
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  devices: [],
  status: 'Estable',
  pathology: 'Diagnóstico E2E',
  specialty: 'Medicina',
  age: '37',
  hasWristband: true,
  surgicalComplication: false,
  isUPC: false,
});

const buildSecondPatient = () => ({
  ...buildParentPatient(),
  id: 'R2',
  bedId: 'R2',
  patientName: 'Paciente Contencion',
  firstName: 'Paciente',
  lastName: 'Contencion',
  secondLastName: '',
  rut: '22.222.222-2',
  clinicalEpisodeId: SECOND_EPISODE_ID,
  pathology: 'Diagnóstico base',
});

const buildClinicalCrib = () => ({
  id: 'R1',
  bedId: 'R1',
  patientName: 'RN Paciente Ciclo Cuna',
  firstName: 'RN',
  lastName: 'Paciente',
  secondLastName: '',
  rut: '',
  identityStatus: 'provisional',
  clinicalEpisodeId: CRIB_EPISODE_ID,
  firstSeenDate: E2E_DATE,
  admissionDate: E2E_DATE,
  admissionTime: '08:30',
  isBlocked: false,
  bedMode: 'Cuna',
  hasCompanionCrib: false,
  devices: [],
  status: 'Estable',
  pathology: '',
  specialty: 'Pediatría',
  age: '0',
  hasWristband: false,
  surgicalComplication: false,
  isUPC: false,
});

const buildRecord = ({ withCrib = false, withSecondPatient = false } = {}) => {
  const record = buildCanonicalE2ERecord(E2E_DATE);
  const beds = record.beds as Record<string, Record<string, unknown>>;
  Object.values(beds).forEach(bed => {
    bed.bedMode = 'Cama';
  });
  beds.R1 = {
    ...beds.R1,
    ...buildParentPatient(),
    ...(withCrib ? { clinicalCrib: buildClinicalCrib() } : {}),
  };
  if (withSecondPatient) {
    beds.R2 = { ...beds.R2, ...buildSecondPatient() };
  }
  return { ...record, beds };
};

const getParentRow = (page: Page) =>
  page.locator('[data-testid="patient-row"][data-bed-id="R1"]').first();

const getSecondRow = (page: Page) =>
  page.locator('[data-testid="patient-row"][data-bed-id="R2"]').first();

const getCribRow = (page: Page) =>
  page
    .locator('tr[data-testid="patient-row"]')
    .filter({ hasText: /\bCUNA\b/ })
    .first();

const openCensus = async (
  page: Page,
  record: Record<string, unknown>
): Promise<DailyRecordAuthorityRouteController> => {
  page.on('console', message => {
    if (message.type() === 'warning' || message.type() === 'error') {
      mark('console', message.type(), { text: message.text().slice(0, 300) });
    }
  });
  page.on('pageerror', error => {
    mark('console', 'pageerror', { text: String(error).slice(0, 300) });
  });
  const authority = await installDailyRecordAuthorityRoute(page, record);
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date: E2E_DATE,
    record,
    useRuntimeOverride: true,
    forceEditableRecord: true,
    forceLocalOnlySync: false,
    seedRemoteAuthority: true,
    forceAuthorityCallable: true,
  });
  await page.goto(`/censo?date=${E2E_DATE}`);
  await ensureAuthenticated(page);
  await page.goto(`/censo?date=${E2E_DATE}`);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
  await expect(getParentRow(page)).toBeVisible();
  return authority;
};

interface PageClockDiag {
  t0: number;
  tCribVisible: number;
  tCribHidden: number;
}

/**
 * Observa el DOM con un MutationObserver dentro de la página: t0 se marca justo
 * antes del clic decisivo y tCribVisible/tCribHidden se estampan con
 * performance.now() del mismo reloj, sin polling externo.
 */
const armCribRowWatcher = (page: Page) =>
  page.evaluate(() => {
    const w = window as Window & { __HHR_DIAG__?: PageClockDiag };
    const hasCribRow = () =>
      Array.from(document.querySelectorAll('tr[data-testid="patient-row"]')).some(row =>
        /\bCUNA\b/.test(row.textContent || '')
      );
    w.__HHR_DIAG__ = { t0: 0, tCribVisible: 0, tCribHidden: 0 };
    if (hasCribRow()) w.__HHR_DIAG__.tCribVisible = -1; // ya visible al armar
    const observer = new MutationObserver(() => {
      const diag = w.__HHR_DIAG__;
      if (!diag) return;
      const present = hasCribRow();
      if (diag.tCribVisible === 0 && present) diag.tCribVisible = performance.now();
      if (diag.tCribVisible !== 0 && diag.tCribHidden === 0 && !present) {
        diag.tCribHidden = performance.now();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });

const markT0 = (page: Page) =>
  page.evaluate(() => {
    (window as Window & { __HHR_DIAG__?: { t0: number } }).__HHR_DIAG__!.t0 = performance.now();
  });

const readDiag = (page: Page): Promise<PageClockDiag> =>
  page.evaluate(
    () => (window as Window & { __HHR_DIAG__?: PageClockDiag }).__HHR_DIAG__ as PageClockDiag
  );

const readLocalMirror = (page: Page) =>
  page.evaluate(date => {
    const records = JSON.parse(localStorage.getItem('hanga_roa_hospital_data') || '{}') as Record<
      string,
      { beds?: Record<string, { patientName?: string; clinicalCrib?: { patientName?: string } }> }
    >;
    const bed = records[date]?.beds?.R1;
    return {
      patientName: bed?.patientName || '',
      hasClinicalCrib: Boolean(bed?.clinicalCrib),
      cribName: bed?.clinicalCrib?.patientName || '',
    };
  }, E2E_DATE);

const waitLocalMirror = async (
  page: Page,
  expected: { hasClinicalCrib: boolean; cribName?: string }
) => {
  await expect
    .poll(() => readLocalMirror(page), { timeout: 10_000, intervals: [25, 50, 100] })
    .toMatchObject(expected);
};

// dispatchEvent evita que el thead sticky o la nav intercepten el puntero del
// menú flotante: dispara el onClick de React directamente y de forma determinista.
const openBedConfigMenu = async (row: Locator) => {
  await row.getByTitle('Configuración de cama').dispatchEvent('click');
};

const clickAgregarCuna = (page: Page) =>
  page.getByRole('button', { name: /Agregar Cuna/i }).dispatchEvent('click');

const confirmClear = async (page: Page, row: Locator) => {
  await row.getByTitle('Acciones').click({ force: true });
  await page.getByTitle('Borrar datos').click({ force: true });
  await expect(page.getByText(/Limpiar (cama|cuna)/i).last()).toBeVisible();
};

const clickConfirmClearButton = (page: Page) =>
  page.getByRole('button', { name: 'Sí, limpiar' }).click();

/**
 * Edita el nombre del paciente de R2 (patch estructural de un solo campo por la
 * ruta canónica UPDATE_PATIENT): dispara una escritura remota no relacionada
 * cuya respuesta del callable queda retenida hasta que el test la libere.
 */
/**
 * Escritura lenta no relacionada: limpieza confirmada de la cama R2 (comando
 * protegido remote-authority-first, así que llega directo al callable y su ACK
 * queda retenido hasta que el test lo libere). Mientras ese ACK no vuelve, el
 * turno de la cola por fecha sigue ocupado por la mutación de R2.
 */
const startUnrelatedSlowWrite = async (
  page: Page,
  authority: DailyRecordAuthorityRouteController,
  scenario: string
) => {
  await confirmClear(page, getSecondRow(page));
  await clickConfirmClearButton(page);
  const call = await authority.nextCall();
  mark(scenario, 'unrelated_callable_started', {
    paths: Object.keys(call.payload.patch),
    intentionalBedClear: call.payload.intentionalBedClear,
  });
  return call;
};

test.describe('Diagnóstico ciclo cama–cuna', () => {
  test('T1 · timeline del ciclo crear → editar → limpiar → recargar → recrear', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const scenario = 'T1-ciclo-completo';
    const authority = await openCensus(page, buildRecord());

    // ---- CREATE ----
    await armCribRowWatcher(page);
    await openBedConfigMenu(getParentRow(page));
    await markT0(page);
    mark(scenario, 'create.action_clicked');
    await clickAgregarCuna(page);

    const createCall = await authority.nextCall();
    mark(scenario, 'create.callable_started', {
      commandId: createCall.payload.syncContract?.mutationId,
      paths: Object.keys(createCall.payload.patch),
    });
    await createCall.succeed();
    mark(scenario, 'create.server_commit_and_ack_released');

    await expect(getCribRow(page)).toBeVisible({ timeout: 10_000 });
    await waitLocalMirror(page, { hasClinicalCrib: true });
    mark(scenario, 'create.indexeddb_committed');

    const createDiag = await readDiag(page);
    const createProjectionMs = createDiag.tCribVisible - createDiag.t0;
    mark(scenario, 'create.projection_visible', { projectionMs: createProjectionMs });

    // ---- EDIT (cuna) ----
    // La edición ordinaria ejecuta assertFirestoreConcurrency (lectura directa a
    // Firestore) ANTES de escribir; en este entorno con el callable interceptado y
    // sin emulador esa lectura falla como offline, así que la edición queda
    // local-first con una tarea de outbox pendiente. Eso reproduce de forma natural
    // el escenario H4 del dossier: el CLEAR siguiente debe adoptar el ACK remoto
    // con un outbox pendiente del mismo árbol cama–cuna.
    const cribNameInput = getCribRow(page).locator('input[name="patientName"]');
    await cribNameInput.fill('RN Editado Diagnostico');
    mark(scenario, 'edit.action_committed');
    await waitLocalMirror(page, { hasClinicalCrib: true, cribName: 'RN Editado Diagnostico' });
    mark(scenario, 'edit.indexeddb_committed_local_first', {
      note: 'remote write falla offline (lectura directa previa); outbox queda pendiente',
    });

    // ---- CLEAR (cuna) ----
    await armCribRowWatcher(page);
    await confirmClear(page, getCribRow(page));
    await markT0(page);
    mark(scenario, 'clear.action_clicked');
    await clickConfirmClearButton(page);
    await expect(getCribRow(page)).toHaveCount(0, { timeout: 5_000 });
    const clearDiag = await readDiag(page);
    mark(scenario, 'clear.projection_hidden', {
      projectionMs: clearDiag.tCribHidden - clearDiag.t0,
    });
    const clearCall = await authority.nextCall();
    mark(scenario, 'clear.callable_started', {
      commandId: clearCall.payload.syncContract?.mutationId,
      intentionalBedClear: clearCall.payload.intentionalBedClear,
    });
    await clearCall.succeed();
    await waitLocalMirror(page, { hasClinicalCrib: false });
    mark(scenario, 'clear.indexeddb_committed');

    // ---- RELOAD ----
    await page.reload();
    await expect(getParentRow(page)).toBeVisible({ timeout: 15_000 });
    await expect(getCribRow(page)).toHaveCount(0);
    mark(scenario, 'reload.ui_converged_without_crib');

    // ---- RECREATE ----
    await armCribRowWatcher(page);
    await openBedConfigMenu(getParentRow(page));
    await markT0(page);
    mark(scenario, 'recreate.action_clicked');
    await clickAgregarCuna(page);
    const recreateCall = await authority.nextCall();
    mark(scenario, 'recreate.callable_started', {
      commandId: recreateCall.payload.syncContract?.mutationId,
      paths: Object.keys(recreateCall.payload.patch),
    });
    await recreateCall.succeed();
    await expect(getCribRow(page)).toBeVisible({ timeout: 10_000 });
    await waitLocalMirror(page, { hasClinicalCrib: true });
    const recreateDiag = await readDiag(page);
    mark(scenario, 'recreate.projection_visible', {
      projectionMs: recreateDiag.tCribVisible - recreateDiag.t0,
    });
    mark(scenario, 'recreate.ui_converged');

    // La recreación se aceptó exactamente una vez: un solo clic, un solo comando.
    expect(
      Object.keys(recreateCall.payload.patch).some(path => path.startsWith('beds.R1.clinicalCrib'))
    ).toBe(true);
  });

  test('T3 · causalidad: la proyección del CREATE espera el ACK de una escritura no relacionada', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const scenario = 'T3-causalidad-create';
    const authority = await openCensus(page, buildRecord({ withSecondPatient: true }));

    const heldCall = await startUnrelatedSlowWrite(page, authority, scenario);

    await armCribRowWatcher(page);
    await openBedConfigMenu(getParentRow(page));
    await markT0(page);
    mark(scenario, 'create.action_clicked_while_unrelated_ack_held');
    await clickAgregarCuna(page);

    // Mientras el ACK no relacionado está retenido, la fila CUNA no puede aparecer.
    await expect(getCribRow(page)).toHaveCount(0);
    const beforeRelease = await readDiag(page);
    expect(beforeRelease.tCribVisible).toBe(0);

    // Marca en el reloj de página el instante exacto de liberación del ACK ajeno.
    const tReleasePage = await page.evaluate(() => performance.now());
    mark(scenario, 'unrelated.server_commit_and_ack_released');
    await heldCall.succeed();

    // Recién liberado el ACK ajeno, el turno avanza y la proyección aparece.
    await expect(getCribRow(page)).toBeVisible({ timeout: 10_000 });
    const afterRelease = await readDiag(page);
    // Causalidad en un solo reloj: la proyección ocurrió DESPUÉS de liberar el ACK.
    expect(afterRelease.tCribVisible).toBeGreaterThan(tReleasePage);
    mark(scenario, 'create.projection_visible', {
      projectionMsFromClick: afterRelease.tCribVisible - afterRelease.t0,
      projectionMsAfterUnrelatedAck: afterRelease.tCribVisible - tReleasePage,
    });

    const createCall = await authority.nextCall();
    mark(scenario, 'create.callable_started', {
      commandId: createCall.payload.syncContract?.mutationId,
    });
    await createCall.succeed();
    await waitLocalMirror(page, { hasClinicalCrib: true });
    mark(scenario, 'create.indexeddb_committed');
  });

  test('T4 · contraste: la proyección del CLEAR es inmediata bajo la misma contención', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const scenario = 'T4-contraste-clear';
    const authority = await openCensus(
      page,
      buildRecord({ withCrib: true, withSecondPatient: true })
    );
    await expect(getCribRow(page)).toBeVisible();

    const heldCall = await startUnrelatedSlowWrite(page, authority, scenario);

    await armCribRowWatcher(page);
    await confirmClear(page, getCribRow(page));
    await markT0(page);
    mark(scenario, 'clear.action_clicked_while_unrelated_ack_held');
    await clickConfirmClearButton(page);

    // El clear se proyecta sin esperar el ACK ajeno (usePendingIntentionalClearTargets).
    await expect(getCribRow(page)).toHaveCount(0, { timeout: 2_000 });
    const diag = await readDiag(page);
    mark(scenario, 'clear.projection_hidden', { projectionMs: diag.tCribHidden - diag.t0 });
    expect(diag.tCribHidden - diag.t0).toBeLessThanOrEqual(2_000);

    mark(scenario, 'unrelated.server_commit_and_ack_released');
    await heldCall.succeed();
    const clearCall = await authority.nextCall();
    await clearCall.succeed();
    await waitLocalMirror(page, { hasClinicalCrib: false });
    mark(scenario, 'clear.indexeddb_committed');
  });

  test('T5 · recarga con ACK de limpieza retenido: nada durable antes del ACK y la cuna sobrevive', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const scenario = 'T5-recarga-ack-retenido';
    const authority = await openCensus(page, buildRecord({ withCrib: true }));
    await expect(getCribRow(page)).toBeVisible();

    await confirmClear(page, getCribRow(page));
    await clickConfirmClearButton(page);
    await expect(getCribRow(page)).toHaveCount(0, { timeout: 2_000 });
    const heldClear = await authority.nextCall();
    mark(scenario, 'clear.callable_started_and_held', {
      commandId: heldClear.payload.syncContract?.mutationId,
    });
    void heldClear; // nunca se libera: simula ACK perdido + recarga

    await page.reload();
    await expect(getParentRow(page)).toBeVisible({ timeout: 15_000 });
    // El comando nunca se confirmó: la cuna debe sobrevivir a la recarga.
    await expect(getCribRow(page)).toBeVisible({ timeout: 10_000 });
    mark(scenario, 'reload.crib_survived_unacked_clear');

    // Y debe poder limpiarse de nuevo, exactamente una vez.
    await confirmClear(page, getCribRow(page));
    await clickConfirmClearButton(page);
    await expect(getCribRow(page)).toHaveCount(0, { timeout: 2_000 });
    const secondClear = await authority.nextCall();
    expect(secondClear.payload.intentionalBedClear).toMatchObject({
      bedId: 'R1',
      target: 'clinicalCrib',
    });
    await secondClear.succeed();
    await waitLocalMirror(page, { hasClinicalCrib: false });
    mark(scenario, 'clear.indexeddb_committed_after_retry');
  });

  test('T2 · presupuesto (FALLA ESPERADA): crear cuna detrás de una escritura lenta no relacionada debe proyectarse en ≤ 200 ms', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const scenario = 'T2-presupuesto-projection';
    const authority = await openCensus(page, buildRecord({ withSecondPatient: true }));

    const heldCall = await startUnrelatedSlowWrite(page, authority, scenario);
    void heldCall; // retenido durante la ventana de medición

    await armCribRowWatcher(page);
    await openBedConfigMenu(getParentRow(page));
    await markT0(page);
    mark(scenario, 'create.action_clicked_while_unrelated_ack_held');
    await clickAgregarCuna(page);

    // Presupuesto provisional del dossier: clic → proyección visible p95 ≤ 200 ms,
    // independiente de la latencia de red. Hoy la proyección del CREATE espera el
    // turno de la cola por fecha (usePatchDailyRecordMutation.onMutate), por lo que
    // esta aserción FALLA sobre main/PR #252: ésa es la evidencia del incidente.
    await expect(getCribRow(page)).toBeVisible({ timeout: PROJECTION_BUDGET_MS });
  });
});
