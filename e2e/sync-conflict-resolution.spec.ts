import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
  readIndexedDbDailyRecord,
} from './fixtures/auth';
import { expectClinicalDiagnosis, expectClinicalStatus } from './fixtures/clinicalBlockEditor';
import { waitForPersistedBedFields } from './fixtures/censusPersistence';
import { installDailyRecordAuthorityRoute } from './fixtures/dailyRecordAuthorityRoute';
import { getTodayISO } from '../src/utils/dateCoreUtils';

const CONFLICT_DATE = process.env.E2E_FIXED_DATE ?? getTodayISO();
const REMOTE_OVERRIDE_SHADOW_KEY = 'hhr_e2e_remote_override_shadow';

const getRow = (page: Page, bedId: string) =>
  page.locator(`[data-testid="patient-row"][data-bed-id="${bedId}"]`).first();

const isRecoverableReloadInterruption = (error: unknown): boolean => {
  const message = String((error as Error)?.message || error);
  return (
    message.includes('ERR_ABORTED') ||
    message.includes('Frame load interrupted') ||
    message.includes('maybe frame was detached')
  );
};

const reloadConflictDate = async (page: Page) => {
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (error) {
    if (!isRecoverableReloadInterruption(error)) {
      throw error;
    }
    await page.goto(`/censo?date=${CONFLICT_DATE}`, { waitUntil: 'domcontentloaded' });
  }

  const currentUrl = new URL(page.url());
  if (currentUrl.searchParams.get('date') !== CONFLICT_DATE) {
    await page.goto(`/censo?date=${CONFLICT_DATE}`, { waitUntil: 'domcontentloaded' });
  }
};

const injectRemoteSnapshotForNextLoad = async (page: Page, record: Record<string, unknown>) => {
  await page.addInitScript(
    ({ date, record: remoteRecord, shadowKey }) => {
      localStorage.setItem(shadowKey, JSON.stringify({ date, record: remoteRecord }));
      const runtimeWindow = window as Window & {
        __HHR_E2E_OVERRIDE__?: Record<string, unknown>;
      };
      const lockedRemoteRecord = remoteRecord;

      runtimeWindow.__HHR_E2E_OVERRIDE__ = new Proxy(
        {
          ...(runtimeWindow.__HHR_E2E_OVERRIDE__ || {}),
          [date]: lockedRemoteRecord,
        },
        {
          set(target, property, value) {
            target[property as string] = property === date ? lockedRemoteRecord : value;
            return true;
          },
        }
      );
    },
    {
      date: CONFLICT_DATE,
      record,
      shadowKey: REMOTE_OVERRIDE_SHADOW_KEY,
    }
  );
};

test.describe('Sync conflict resolution', () => {
  test('keeps the view stable and reopens the newer externally-seeded snapshot on reload', async ({
    page,
  }) => {
    const baseRecord = buildCanonicalE2ERecord(CONFLICT_DATE);
    const beds = (baseRecord.beds as Record<string, Record<string, unknown>>) || {};

    beds.R1 = {
      ...beds.R1,
      patientName: 'CONFLICT BASELINE',
      rut: '12345678-5',
      clinicalEpisodeId: 'synthetic-conflict-r1',
      pathology: 'BASE DX',
      status: 'Estable',
      admissionDate: CONFLICT_DATE,
    };

    const authority = await installDailyRecordAuthorityRoute(page, { ...baseRecord, beds });
    await bootstrapSeededRecord(page, {
      role: 'editor',
      date: CONFLICT_DATE,
      record: { ...baseRecord, beds },
      useRuntimeOverride: true,
      forceLocalOnlySync: false,
      seedRemoteAuthority: true,
      forceAuthorityCallable: true,
    });

    await page.goto(`/censo?date=${CONFLICT_DATE}`);
    await ensureAuthenticated(page);
    await page.goto(`/censo?date=${CONFLICT_DATE}`);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });

    const row = getRow(page, 'R1');
    const demographicsButton = row.getByRole('button', { name: /Datos del Paciente/i });
    const patientNameInput = row.locator('input[name="patientName"]').first();
    await demographicsButton.click();
    const demographicsDialog = page.getByRole('dialog', { name: 'Datos Demográficos' });
    await expect(demographicsDialog).toBeVisible();
    await demographicsDialog.getByPlaceholder('Nombre').fill('Local');
    await demographicsDialog.getByPlaceholder('Apellido paterno').fill('Draft');
    await demographicsDialog.getByRole('button', { name: /Guardar Cambios/i }).click();
    const accepted = await authority.nextCall();
    await accepted.succeed();
    await expect(demographicsDialog).toBeHidden();

    await expect(patientNameInput).toHaveValue('Local Draft');
    await waitForPersistedBedFields({
      page,
      date: CONFLICT_DATE,
      bedId: 'R1',
      expected: {
        patientName: 'Local Draft',
        firstName: 'Local',
        lastName: 'Draft',
        secondLastName: '',
      },
    });

    // The callable response can arrive before the client releases its durable ACK hold.
    // Reload only after the saved edit is durable and no write still protects it.
    await expect
      .poll(() =>
        page.evaluate(async date => {
          const request = indexedDB.open('HangaRoaDB');
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const tx = db.transaction(['dailyRecords', 'syncQueue'], 'readonly');
            const record = tx.objectStore('dailyRecords').get(date);
            const pending = tx.objectStore('syncQueue').count();
            await new Promise<void>((resolve, reject) => {
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(tx.error);
              tx.onabort = () => reject(tx.error);
            });
            return { bed: record.result?.beds?.R1, pending: pending.result };
          } finally {
            db.close();
          }
        }, CONFLICT_DATE)
      )
      .toMatchObject({
        bed: {
          patientName: 'Local Draft',
          firstName: 'Local',
          lastName: 'Draft',
          secondLastName: '',
        },
        pending: 0,
      });

    const remoteRecord = await page.evaluate(date => {
      const storageKey = 'hanga_roa_hospital_data';
      const records = JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<
        string,
        Record<string, unknown>
      >;
      const currentRecord = (records[date] || {}) as {
        beds?: Record<string, Record<string, unknown>>;
      };
      const currentBeds = currentRecord.beds || {};

      const nextRecord = {
        ...currentRecord,
        lastUpdated: `${date}T23:59:59.000Z`,
        beds: {
          ...currentBeds,
          R1: {
            ...(currentBeds.R1 || {}),
            patientName: 'REMOTE VERSION',
            firstName: 'REMOTE',
            lastName: 'VERSION',
            secondLastName: '',
            identityStatus: 'official',
            pathology: 'REMOTE DX',
            status: 'Grave',
          },
        },
      };
      const runtimeWindow = window as Window & {
        __HHR_E2E_SET_REMOTE_AUTHORITY__?: (date: string, record: unknown) => void;
        __HHR_E2E_OVERRIDE__?: Record<string, unknown>;
      };
      if (!runtimeWindow.__HHR_E2E_SET_REMOTE_AUTHORITY__) {
        throw new Error('The remote authority fixture was not installed');
      }
      runtimeWindow.__HHR_E2E_SET_REMOTE_AUTHORITY__(date, nextRecord);
      return {
        expected: nextRecord,
        authority: runtimeWindow.__HHR_E2E_OVERRIDE__?.[date],
        shadow: JSON.parse(localStorage.getItem('hhr_e2e_remote_override_shadow') || 'null'),
      };
    }, CONFLICT_DATE);

    expect(remoteRecord.authority).toEqual(remoteRecord.expected);
    expect(remoteRecord.shadow).toEqual({ date: CONFLICT_DATE, record: remoteRecord.expected });
    await page.reload();

    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
    await expect(patientNameInput).toHaveValue('REMOTE VERSION');
    await expectClinicalDiagnosis(row, 'REMOTE DX');
    await expectClinicalStatus(row, 'Grave');
  });

  test('accepts remote canonical census fields after a stale local narrative seed without pending writes', async ({
    page,
  }) => {
    const baseRecord = buildCanonicalE2ERecord(CONFLICT_DATE);
    const beds = (baseRecord.beds as Record<string, Record<string, unknown>>) || {};

    beds.R1 = {
      ...beds.R1,
      patientName: 'OFFLINE BASELINE',
      clinicalEpisodeId: 'synthetic-stale-r1',
      pathology: 'BASE DX',
      status: 'Estable',
      admissionDate: CONFLICT_DATE,
    };

    await bootstrapSeededRecord(page, {
      role: 'editor',
      date: CONFLICT_DATE,
      record: {
        ...baseRecord,
        lastUpdated: `${CONFLICT_DATE}T08:00:00.000Z`,
        beds,
      },
      useRuntimeOverride: true,
    });

    await page.goto(`/censo?date=${CONFLICT_DATE}`);
    await ensureAuthenticated(page);
    await page.goto(`/censo?date=${CONFLICT_DATE}`);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });

    const row = getRow(page, 'R1');
    const patientNameInput = row.locator('input[name="patientName"]').first();
    await expect(patientNameInput).toHaveValue('OFFLINE BASELINE');

    const durable = (await readIndexedDbDailyRecord(page, CONFLICT_DATE)) as typeof baseRecord;
    const durableBeds = durable.beds as typeof beds;
    const localPendingRecord = {
      ...durable,
      lastUpdated: `${CONFLICT_DATE}T12:00:00.000Z`,
      beds: {
        ...durableBeds,
        R1: {
          ...durableBeds.R1,
          patientName: 'Local Offline Winner',
          firstName: 'Local',
          lastName: 'Offline',
          secondLastName: 'Winner',
          pathology: 'LOCAL OFFLINE DX',
          handoffNoteDayShift: 'LOCAL OFFLINE NOTE',
        },
      },
    };

    await page.evaluate(async record => {
      const request = indexedDB.open('HangaRoaDB');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['dailyRecords', 'syncQueue'], 'readwrite');
          const count = tx.objectStore('syncQueue').count();
          count.onsuccess = () => {
            if (count.result) {
              tx.abort();
              return;
            }
            tx.objectStore('dailyRecords').put(record);
          };
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(new Error('Stale seed must not discard pending writes'));
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }, localPendingRecord);
    await page.context().setOffline(true);

    const remoteRecord = {
      ...localPendingRecord,
      lastUpdated: `${CONFLICT_DATE}T09:00:00.000Z`,
      beds: {
        ...localPendingRecord.beds,
        R1: {
          ...localPendingRecord.beds.R1,
          patientName: 'REMOTE STALE USER',
          firstName: 'REMOTE',
          lastName: 'STALE',
          secondLastName: 'USER',
          pathology: 'REMOTE STALE DX',
          handoffNoteDayShift: 'REMOTE STALE NOTE',
          status: 'Grave',
        },
      },
    };

    await injectRemoteSnapshotForNextLoad(page, remoteRecord);

    await page.context().setOffline(false);
    await reloadConflictDate(page);

    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
    await expect(patientNameInput).toHaveValue('REMOTE STALE USER');
    await expectClinicalDiagnosis(row, 'REMOTE STALE DX');
    await expectClinicalStatus(row, 'Grave');
    await waitForPersistedBedFields({
      page,
      date: CONFLICT_DATE,
      bedId: 'R1',
      expected: {
        patientName: 'REMOTE STALE USER',
        pathology: 'REMOTE STALE DX',
      },
    });
  });
});
