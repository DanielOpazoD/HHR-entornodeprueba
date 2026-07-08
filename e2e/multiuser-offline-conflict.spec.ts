import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { expectClinicalDiagnosis, updateClinicalDiagnosis } from './fixtures/clinicalBlockEditor';
import { seedPersistedBedFields, waitForPersistedBedFields } from './fixtures/censusPersistence';

const MULTIUSER_DATE = process.env.E2E_FIXED_DATE ?? new Date().toISOString().slice(0, 10);

const getRow = (page: Page, bedId: string) =>
  page.locator(`[data-testid="patient-row"][data-bed-id="${bedId}"]`).first();

const openSeededCensus = async (page: Page) => {
  const baseRecord = buildCanonicalE2ERecord(MULTIUSER_DATE);
  const beds = (baseRecord.beds as Record<string, Record<string, unknown>>) || {};

  beds.R1 = {
    ...beds.R1,
    patientName: 'MULTIUSER BASELINE',
    pathology: 'BASE DX',
    status: 'Estable',
    admissionDate: MULTIUSER_DATE,
  };

  await bootstrapSeededRecord(page, {
    role: 'editor',
    date: MULTIUSER_DATE,
    record: {
      ...baseRecord,
      lastUpdated: `${MULTIUSER_DATE}T08:00:00.000Z`,
      beds,
    },
    useRuntimeOverride: true,
  });

  await page.goto(`/census?date=${MULTIUSER_DATE}`);
  await ensureAuthenticated(page);
  await page.goto(`/census?date=${MULTIUSER_DATE}`);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
};

const buildStaleRemoteSnapshotFromUserB = async (page: Page) =>
  page.evaluate(date => {
    const storageKey = 'hanga_roa_hospital_data';
    const records = JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<
      string,
      { beds?: Record<string, Record<string, unknown>>; lastUpdated?: string }
    >;
    const currentRecord = records[date] || {};
    const currentBeds = currentRecord.beds || {};

    return {
      ...currentRecord,
      lastUpdated: `${date}T09:00:00.000Z`,
      beds: {
        ...currentBeds,
        R1: {
          ...(currentBeds.R1 || {}),
          patientName: 'REMOTE USER B',
          pathology: 'REMOTE USER B DX',
          status: 'Grave',
        },
      },
    };
  }, MULTIUSER_DATE);

const buildCurrentRecordSnapshot = async (page: Page) =>
  page.evaluate(date => {
    const storageKey = 'hanga_roa_hospital_data';
    const records = JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<
      string,
      { beds?: Record<string, Record<string, unknown>>; lastUpdated?: string }
    >;

    return records[date] || null;
  }, MULTIUSER_DATE);

const buildRemoteSnapshotWithBedFields = async (
  page: Page,
  bedId: string,
  fields: Record<string, string>
) => {
  const current = (await buildCurrentRecordSnapshot(page)) as Record<string, unknown> | null;
  const currentBeds = (current?.beds || {}) as Record<string, Record<string, unknown>>;

  return {
    ...(current || {}),
    date: MULTIUSER_DATE,
    lastUpdated: `${MULTIUSER_DATE}T09:00:00.000Z`,
    beds: {
      ...currentBeds,
      [bedId]: {
        ...(currentBeds[bedId] || {}),
        ...fields,
      },
    },
  };
};

const injectRemoteSnapshotForNextLoad = async (page: Page, snapshot: Record<string, unknown>) => {
  await page.evaluate(
    ({ date, record }) => {
      localStorage.setItem('hhr_e2e_remote_override_shadow', JSON.stringify({ date, record }));
    },
    {
      date: MULTIUSER_DATE,
      record: snapshot,
    }
  );

  await page.addInitScript(() => {
    const remoteShadow = localStorage.getItem('hhr_e2e_remote_override_shadow');
    if (!remoteShadow) return;

    const parsed = JSON.parse(remoteShadow) as { date: string; record: unknown };
    const runtimeWindow = window as Window & {
      __HHR_E2E_OVERRIDE__?: Record<string, unknown>;
    };
    const lockedRemoteRecord = parsed.record;

    runtimeWindow.__HHR_E2E_OVERRIDE__ = new Proxy(
      {
        ...(runtimeWindow.__HHR_E2E_OVERRIDE__ || {}),
        [parsed.date]: lockedRemoteRecord,
      },
      {
        set(target, property, value) {
          target[property as string] = property === parsed.date ? lockedRemoteRecord : value;
          return true;
        },
      }
    );
  });
};

const closeAll = async (contexts: BrowserContext[]) => {
  await Promise.all(contexts.map(context => context.close().catch(() => undefined)));
};

test.describe('Multi-user offline conflict smoke', () => {
  test('accepts Firebase canonical census fields on reconnect', async ({ browser }) => {
    test.setTimeout(90_000);
    const userAContext = await browser.newContext();
    const userBContext = await browser.newContext();

    try {
      const userAPage = await userAContext.newPage();
      const userBPage = await userBContext.newPage();

      await openSeededCensus(userAPage);
      await openSeededCensus(userBPage);

      const userARow = getRow(userAPage, 'R1');

      await expect(userARow.locator('input[name="patientName"]').first()).toHaveValue(
        'MULTIUSER BASELINE'
      );
      await expectClinicalDiagnosis(userARow, 'BASE DX');

      await userAContext.setOffline(true);
      await expect.poll(() => userAPage.evaluate(() => navigator.onLine)).toBe(false);

      await updateClinicalDiagnosis(userAPage, userARow, 'R1', 'USER A OFFLINE DX');
      await seedPersistedBedFields({
        page: userAPage,
        date: MULTIUSER_DATE,
        bedId: 'R1',
        fields: {
          patientName: 'MULTIUSER BASELINE',
          pathology: 'USER A OFFLINE DX',
        },
      });
      await waitForPersistedBedFields({
        page: userAPage,
        date: MULTIUSER_DATE,
        bedId: 'R1',
        expected: {
          patientName: 'MULTIUSER BASELINE',
          pathology: 'USER A OFFLINE DX',
        },
      });

      const staleRemoteSnapshot = await buildStaleRemoteSnapshotFromUserB(userBPage);
      await injectRemoteSnapshotForNextLoad(userAPage, staleRemoteSnapshot);

      await userAContext.setOffline(false);
      await expect.poll(() => userAPage.evaluate(() => navigator.onLine)).toBe(true);
      await userAPage.reload({ waitUntil: 'domcontentloaded' });

      await expect(userAPage.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
      await expect(userARow.locator('input[name="patientName"]').first()).toHaveValue(
        'REMOTE USER B'
      );
      await expectClinicalDiagnosis(userARow, 'REMOTE USER B DX');
    } finally {
      await closeAll([userAContext, userBContext]);
    }
  });

  test('accepts remote canonical fields and user B non-conflicting bed update after reconnect', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const userAContext = await browser.newContext();
    const userBContext = await browser.newContext();

    try {
      const userAPage = await userAContext.newPage();
      const userBPage = await userBContext.newPage();

      await openSeededCensus(userAPage);
      await openSeededCensus(userBPage);

      const userAR1 = getRow(userAPage, 'R1');

      await userAContext.setOffline(true);
      await expect.poll(() => userAPage.evaluate(() => navigator.onLine)).toBe(false);

      await updateClinicalDiagnosis(userAPage, userAR1, 'R1', 'USER A LOCAL DX');
      await seedPersistedBedFields({
        page: userAPage,
        date: MULTIUSER_DATE,
        bedId: 'R1',
        fields: {
          patientName: 'MULTIUSER BASELINE',
          pathology: 'USER A LOCAL DX',
        },
      });
      await waitForPersistedBedFields({
        page: userAPage,
        date: MULTIUSER_DATE,
        bedId: 'R1',
        expected: {
          patientName: 'MULTIUSER BASELINE',
          pathology: 'USER A LOCAL DX',
        },
      });

      await seedPersistedBedFields({
        page: userBPage,
        date: MULTIUSER_DATE,
        bedId: 'R2',
        fields: {
          patientName: 'USER B NEW PATIENT',
          pathology: 'USER B NON CONFLICT DX',
          status: 'Estable',
          admissionDate: MULTIUSER_DATE,
        },
      });
      await waitForPersistedBedFields({
        page: userBPage,
        date: MULTIUSER_DATE,
        bedId: 'R2',
        expected: {
          patientName: 'USER B NEW PATIENT',
          pathology: 'USER B NON CONFLICT DX',
        },
      });

      const userBRemoteSnapshot = await buildRemoteSnapshotWithBedFields(userBPage, 'R2', {
        patientName: 'USER B NEW PATIENT',
        pathology: 'USER B NON CONFLICT DX',
        status: 'Estable',
        admissionDate: MULTIUSER_DATE,
      });
      await injectRemoteSnapshotForNextLoad(userAPage, userBRemoteSnapshot);

      await userAContext.setOffline(false);
      await expect.poll(() => userAPage.evaluate(() => navigator.onLine)).toBe(true);
      await userAPage.reload({ waitUntil: 'domcontentloaded' });

      await expect(userAPage.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
      await expect(userAR1.locator('input[name="patientName"]').first()).toHaveValue(
        'MULTIUSER BASELINE'
      );
      await expectClinicalDiagnosis(userAR1, 'BASE DX');

      const userAR2 = getRow(userAPage, 'R2');
      await expect(userAR2.locator('input[name="patientName"]').first()).toHaveValue(
        'USER B NEW PATIENT'
      );
      await expectClinicalDiagnosis(userAR2, 'USER B NON CONFLICT DX');
    } finally {
      await closeAll([userAContext, userBContext]);
    }
  });
});
