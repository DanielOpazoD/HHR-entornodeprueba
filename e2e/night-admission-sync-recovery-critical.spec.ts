import { expect, test, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { waitForPersistedBedFields } from './fixtures/censusPersistence';
import { updateClinicalDiagnosis } from './fixtures/clinicalBlockEditor';
import { installDailyRecordAuthorityRoute } from './fixtures/dailyRecordAuthorityRoute';
import { installSyncQueueTransportHarness } from './fixtures/syncQueueTransportHarness';

const E2E_DATE = process.env.E2E_FIXED_DATE ?? '2026-02-20';
const DISPLAY_ADMISSION_DATE = E2E_DATE.split('-').reverse().join('-');
const E2E_BED = 'R1';
const NIGHT_ADMISSION_TIME = '23:40';
const PATIENT_NAME = 'Paciente Nocturno Sintético';
const DIAGNOSIS = 'Diagnóstico sintético tras ingreso nocturno';

const buildEmptyNightAdmissionRecord = () => {
  const record = buildCanonicalE2ERecord(E2E_DATE);
  const beds = record.beds as Record<string, Record<string, unknown>>;
  beds[E2E_BED] = {
    ...beds[E2E_BED],
    patientName: '',
    rut: '',
    pathology: '',
    status: '',
    admissionDate: E2E_DATE,
    admissionTime: NIGHT_ADMISSION_TIME,
  };
  return { ...record, beds };
};

const getPatientRow = (page: Page) =>
  page.locator(`[data-testid="patient-row"][data-bed-id="${E2E_BED}"]`).first();

const getEmptyBedRow = (page: Page) =>
  page.locator('tbody tr').filter({ hasText: E2E_BED }).first();

const readQueueCount = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('HangaRoaDB');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('syncQueue', 'readonly');
          const count = transaction.objectStore('syncQueue').count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
          transaction.oncomplete = () => db.close();
        };
      })
  );

const readQueuedDiagnosisRuntime = (page: Page) =>
  page.evaluate(
    date =>
      new Promise<{ status: string; hasLease: boolean } | null>((resolve, reject) => {
        const request = indexedDB.open('HangaRoaDB');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('syncQueue', 'readonly');
          const all = transaction.objectStore('syncQueue').getAll();
          all.onsuccess = () => {
            const task = all.result.find(
              candidate =>
                candidate.type === 'UPDATE_DAILY_RECORD' && candidate.key === `daily:${date}`
            );
            resolve(
              task
                ? {
                    status: task.status,
                    hasLease: Boolean(task.leaseOwner || task.attemptId || task.leaseUntil),
                  }
                : null
            );
          };
          all.onerror = () => reject(all.error);
          transaction.oncomplete = () => db.close();
        };
      }),
    E2E_DATE
  );

const waitForEmptyQueue = async (page: Page) => {
  await expect.poll(() => readQueueCount(page), { timeout: 15_000 }).toBe(0);
};

const prepareQueuedDiagnosisAttempt = (page: Page) =>
  page.evaluate(
    date =>
      new Promise<{ taskId: number; mutationId: string }>((resolve, reject) => {
        let identity: { taskId: number; mutationId: string } | null = null;
        const request = indexedDB.open('HangaRoaDB');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('syncQueue', 'readwrite');
          const queue = transaction.objectStore('syncQueue');
          const getQueuedTasks = queue.getAll();
          getQueuedTasks.onerror = () => reject(getQueuedTasks.error);
          getQueuedTasks.onsuccess = () => {
            const queuedDiagnosis = getQueuedTasks.result.find(
              task => task.type === 'UPDATE_DAILY_RECORD' && task.key === `daily:${date}`
            );
            const mutationId = queuedDiagnosis?.syncContract?.mutationId || '';
            if (!queuedDiagnosis?.id || !mutationId) {
              reject(new Error(`No queued diagnosis identity available for ${date}`));
              return;
            }
            if (queuedDiagnosis.status !== 'PENDING' || queuedDiagnosis.leaseOwner) {
              reject(new Error(`Queued diagnosis operation is already active for ${date}`));
              return;
            }
            identity = { taskId: queuedDiagnosis.id, mutationId };
            queue.put({
              ...queuedDiagnosis,
              nextAttemptAt: 0,
              preOutboxHoldState: undefined,
              preOutboxHoldOwner: undefined,
              preOutboxHoldUntil: undefined,
              preOutboxHoldReason: undefined,
              preOutboxHoldHeartbeatAt: undefined,
            });
          };
          transaction.oncomplete = () => {
            db.close();
            if (identity) resolve(identity);
          };
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        };
      }),
    E2E_DATE
  );

const seedFailedDiagnosisTask = (page: Page) =>
  page.evaluate(
    date =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('HangaRoaDB');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(['dailyRecords', 'syncQueue'], 'readwrite');
          const getRecord = transaction.objectStore('dailyRecords').get(date);
          getRecord.onsuccess = () => {
            transaction.objectStore('syncQueue').add({
              opId: `e2e-night-diagnosis-${Date.now()}`,
              type: 'UPDATE_DAILY_RECORD',
              payload: getRecord.result,
              timestamp: Date.now(),
              status: 'FAILED',
              retryCount: 2,
              error: 'Fallo sintético recuperable',
              lastErrorCode: 'unavailable',
              lastErrorCategory: 'network',
              lastErrorSeverity: 'medium',
              lastErrorAction: 'Reintentar cuando vuelva la conexión.',
              lastErrorAt: Date.now(),
              key: `daily:${date}`,
              ownerKey: localStorage.getItem('hhr_session_owner_v1') || undefined,
              origin: 'direct_queue',
              recoveryPolicy: 'clinical_retry',
              syncContract: {
                mutationId: 'e2e-night-diagnosis-retry',
                changedPaths: ['beds.R1.pathology'],
              },
            });
          };
          getRecord.onerror = () => reject(getRecord.error);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    E2E_DATE
  );

const clearPatient = async (page: Page) => {
  await getPatientRow(page).getByTitle('Acciones').click();
  const menu = page.getByTestId('patient-row-menu-portal');
  await expect(menu).toBeVisible();
  await menu.getByTitle('Borrar datos').click();
  await expect(page.getByText(/Limpiar cama/i).last()).toBeVisible();
  await page.getByRole('button', { name: 'Sí, limpiar' }).click();
};

test.describe('Night admission critical sync recovery', () => {
  test('admits, diagnoses, retries synchronization, clears, and survives reload', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const record = buildEmptyNightAdmissionRecord();
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
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });

    const emptyBed = getEmptyBedRow(page);
    await expect(emptyBed).toBeVisible();
    await emptyBed.getByText('Agregar paciente').click();
    await expect(page.getByText('Datos Demográficos', { exact: true })).toBeVisible();
    await page.getByPlaceholder('Nombre', { exact: true }).fill('Paciente');
    await page.getByPlaceholder('Apellido paterno').fill('Nocturno');
    await page.getByPlaceholder('Apellido materno').fill('Sintético');
    await page.getByPlaceholder('12.345.678-9').fill('11.111.111-1');
    await page.locator('input[type="date"]').first().fill('1990-01-01');
    await page.getByLabel('Origen del ingreso').selectOption('Urgencias');
    await page.locator('#demographics-admission-date').selectOption(E2E_DATE);
    await page.getByLabel('Hora de ingreso', { exact: true }).fill(NIGHT_ADMISSION_TIME);
    await page.getByRole('group', { name: 'Sexo biológico' }).locator('label').first().click();
    const saveDemographics = page.getByRole('button', { name: 'Guardar Cambios' });
    await expect(saveDemographics).toBeEnabled();
    await saveDemographics.click();
    const admissionCall = await authority.nextCall();
    expect(JSON.stringify(admissionCall.payload.patch)).toContain(PATIENT_NAME);
    await admissionCall.succeed();
    await waitForPersistedBedFields({
      page,
      date: E2E_DATE,
      bedId: E2E_BED,
      expected: { patientName: PATIENT_NAME, admissionTime: NIGHT_ADMISSION_TIME },
    });
    await expect(getPatientRow(page)).toContainText(`FI:${DISPLAY_ADMISSION_DATE}`);
    await waitForEmptyQueue(page);

    await updateClinicalDiagnosis(page, getPatientRow(page), E2E_BED, DIAGNOSIS);
    await waitForPersistedBedFields({
      page,
      date: E2E_DATE,
      bedId: E2E_BED,
      expected: { pathology: DIAGNOSIS },
    });
    await expect.poll(() => readQueueCount(page), { timeout: 10_000 }).toBe(1);
    const { mutationId: diagnosisMutationId } = await prepareQueuedDiagnosisAttempt(page);
    if (authority.queuedCallCount() === 0) {
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
    }
    await expect.poll(() => authority.queuedCallCount(), { timeout: 15_000 }).toBe(1);
    const diagnosisCall = await authority.nextCall();
    expect(diagnosisCall.payload.syncContract?.mutationId).toBe(diagnosisMutationId);
    await diagnosisCall.succeed();
    await waitForEmptyQueue(page);

    await page.reload();
    await ensureAuthenticated(page);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
    const syncTransport = await installSyncQueueTransportHarness(page);
    await seedFailedDiagnosisTask(page);
    await expect
      .poll(() => readQueuedDiagnosisRuntime(page), { timeout: 10_000 })
      .toEqual({ status: 'FAILED', hasLease: false });
    const syncChip = page.getByTestId('sync-queue-status-chip');
    await expect(syncChip).toContainText('1 sin sincronizar', { timeout: 10_000 });
    expect(authority.queuedCallCount()).toBe(0);
    await syncChip.click();
    await page.getByTestId('sync-queue-op-retry').click();
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    const retryCall = await syncTransport.nextCall();
    expect((retryCall.task.syncContract as { mutationId?: string } | undefined)?.mutationId).toBe(
      'e2e-night-diagnosis-retry'
    );
    retryCall.succeed();
    await waitForEmptyQueue(page);
    await expect(syncChip).toHaveCount(0, { timeout: 10_000 });
    await syncTransport.disable();

    await clearPatient(page);
    const clearCall = await authority.nextCall();
    expect(clearCall.payload.intentionalBedClear).toMatchObject({ bedId: E2E_BED });
    await clearCall.succeed();
    await waitForPersistedBedFields({
      page,
      date: E2E_DATE,
      bedId: E2E_BED,
      expected: { patientName: '' },
    });
    await waitForEmptyQueue(page);

    await page.reload();
    await ensureAuthenticated(page);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
    await expect(getPatientRow(page)).toHaveCount(0);
    await expect(getEmptyBedRow(page)).toBeVisible();
  });
});
