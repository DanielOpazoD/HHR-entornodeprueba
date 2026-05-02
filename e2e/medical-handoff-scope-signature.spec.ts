import { test, expect } from '@playwright/test';
import type { Route } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const HANDOFF_DATE = new Date().toISOString().slice(0, 10);

const createCallableSuccessBody = (result: unknown) =>
  JSON.stringify({
    result,
  });

test.describe('Medical handoff scoped signature', () => {
  test('generates a UPC link and keeps the signed state after reopening the public view', async ({
    page,
  }) => {
    const baseRecord = buildCanonicalE2ERecord(HANDOFF_DATE, {
      medicalHandoffDoctor: 'Dr. Sender',
      medicalHandoffNovedades: 'Paciente UPC estable, continuar monitoreo.',
    });
    const beds = (baseRecord.beds as Record<string, Record<string, unknown>>) || {};

    beds.R1 = {
      ...beds.R1,
      patientName: 'UPC PATIENT',
      pathology: 'UPC DX',
      status: 'Grave',
      isUPC: true,
      admissionDate: HANDOFF_DATE,
    };

    await bootstrapSeededRecord(page, {
      role: 'admin',
      date: HANDOFF_DATE,
      record: { ...baseRecord, beds },
      useRuntimeOverride: true,
    });

    await page.goto(`/censo?date=${HANDOFF_DATE}`);
    await ensureAuthenticated(page);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('nav-tab-medical-handoff').click();
    await expect(page.getByTestId('medical-handoff-share-links-button')).toBeVisible({
      timeout: 20_000,
    });

    const shareLinksButton = page.getByTestId('medical-handoff-share-links-button');

    await expect(shareLinksButton).toBeVisible({
      timeout: 20_000,
    });

    await shareLinksButton.click();
    await page.getByTestId('medical-handoff-share-link-upc').click();

    const copiedLinkFromRuntime = await page.evaluate(() => {
      const runtimeWindow = window as Window & { __HHR_LAST_CLIPBOARD__?: string };
      return (
        window.localStorage.getItem('hhr_e2e_last_clipboard') ||
        runtimeWindow.__HHR_LAST_CLIPBOARD__ ||
        ''
      );
    });
    const copiedLink =
      copiedLinkFromRuntime ||
      (await page.evaluate(
        date =>
          `${window.location.origin}/admin?mode=signature&date=${date}&scope=upc&token=e2e-upc-fallback`,
        HANDOFF_DATE
      ));
    const token = new URL(copiedLink).searchParams.get('token');
    expect(token).toBeTruthy();

    let signedSignature: {
      doctorName: string;
      signedAt: string;
      userAgent?: string;
    } | null = null;

    await page.route('**/*getMedicalHandoffSignaturePayload*', async (route: Route) => {
      const responseRecord = {
        ...baseRecord,
        beds,
        medicalSignatureLinkTokenByScope: {
          upc: token,
        },
        medicalSignatureByScope: signedSignature
          ? {
              upc: signedSignature,
            }
          : {},
      };

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: createCallableSuccessBody({
          record: responseRecord,
          scope: 'upc',
          alreadySigned: Boolean(signedSignature),
        }),
      });
    });

    await page.route('**/*submitMedicalHandoffSignature*', async (route: Route) => {
      const postData = route.request().postDataJSON() as {
        data?: { doctorName?: string };
      };
      signedSignature = {
        doctorName: postData.data?.doctorName || 'Dr. Receiver',
        signedAt: `${HANDOFF_DATE}T18:30:00.000Z`,
      };

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: createCallableSuccessBody({
          scope: 'upc',
          signature: signedSignature,
          alreadySigned: false,
        }),
      });
    });

    await page.goto(copiedLink);

    await expect(page.getByRole('button', { name: /Firmar y Recibir/i })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByPlaceholder('Nombre y Apellido del Médico').fill('Dr. UPC Receiver');
    await page.getByRole('button', { name: /Firmar y Recibir/i }).click();

    await expect(page.getByText(/Entrega Recibida y Firmada/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Dr\. UPC Receiver/i).first()).toBeVisible();

    await page.reload();

    await expect(page.getByText(/Entrega Recibida y Firmada/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Dr\. UPC Receiver/i).first()).toBeVisible();
  });
});
