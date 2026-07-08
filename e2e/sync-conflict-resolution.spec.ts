import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { expectClinicalDiagnosis, expectClinicalStatus } from './fixtures/clinicalBlockEditor';
import { seedPersistedBedFields, waitForPersistedBedFields } from './fixtures/censusPersistence';

const CONFLICT_DATE = process.env.E2E_FIXED_DATE ?? new Date().toISOString().slice(0, 10);
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
      pathology: 'BASE DX',
      status: 'Estable',
      admissionDate: CONFLICT_DATE,
    };

    await bootstrapSeededRecord(page, {
      role: 'editor',
      date: CONFLICT_DATE,
      record: { ...baseRecord, beds },
      useRuntimeOverride: true,
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
    await expect(demographicsDialog).toBeHidden();

    await expect(patientNameInput).toHaveValue('Local Draft');
    await seedPersistedBedFields({
      page,
      date: CONFLICT_DATE,
      bedId: 'R1',
      fields: {
        patientName: 'Local Draft',
        firstName: 'Local',
        lastName: 'Draft',
        secondLastName: '',
      },
    });
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

      return {
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
    }, CONFLICT_DATE);

    await injectRemoteSnapshotForNextLoad(page, remoteRecord);
    await page.reload();

    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
    await expect(patientNameInput).toHaveValue('REMOTE VERSION');
    await expectClinicalDiagnosis(row, 'REMOTE DX');
    await expectClinicalStatus(row, 'Grave');
  });

  test('accepts remote canonical census fields after a stale local narrative seed', async ({
    page,
  }) => {
    const baseRecord = buildCanonicalE2ERecord(CONFLICT_DATE);
    const beds = (baseRecord.beds as Record<string, Record<string, unknown>>) || {};

    beds.R1 = {
      ...beds.R1,
      patientName: 'OFFLINE BASELINE',
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
    const demographicsButton = row.getByRole('button', { name: /Datos del Paciente/i });
    const patientNameInput = row.locator('input[name="patientName"]').first();
    await expect(patientNameInput).toHaveValue('OFFLINE BASELINE');

    await demographicsButton.click();
    const demographicsDialog = page.getByRole('dialog', { name: 'Datos Demográficos' });
    await expect(demographicsDialog).toBeVisible();
    await demographicsDialog.getByPlaceholder('Nombre').fill('Local Offline');
    await demographicsDialog.getByPlaceholder('Apellido paterno').fill('Winner');
    await demographicsDialog.getByRole('button', { name: /Guardar Cambios/i }).click();
    await expect(demographicsDialog).toBeHidden();
    await expect(patientNameInput).toHaveValue('Local Offline Winner');

    const localPendingRecord = {
      ...baseRecord,
      lastUpdated: `${CONFLICT_DATE}T12:00:00.000Z`,
      beds: {
        ...beds,
        R1: {
          ...beds.R1,
          patientName: 'Local Offline Winner',
          firstName: 'Local',
          lastName: 'Offline',
          secondLastName: 'Winner',
          pathology: 'LOCAL OFFLINE DX',
          handoffNoteDayShift: 'LOCAL OFFLINE NOTE',
        },
      },
    };

    await page.addInitScript(
      ({ date, record }) => {
        const storageKey = 'hanga_roa_hospital_data';
        const records = JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<
          string,
          unknown
        >;
        records[date] = record;
        localStorage.setItem(storageKey, JSON.stringify(records));
      },
      { date: CONFLICT_DATE, record: localPendingRecord }
    );
    await page.context().setOffline(true);

    const remoteRecord = {
      ...localPendingRecord,
      lastUpdated: `${CONFLICT_DATE}T09:00:00.000Z`,
      beds: {
        ...localPendingRecord.beds,
        R1: {
          ...localPendingRecord.beds.R1,
          patientName: 'REMOTE STALE USER',
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
