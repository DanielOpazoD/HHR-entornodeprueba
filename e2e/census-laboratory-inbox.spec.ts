import { expect, test } from '@playwright/test';
import { seedVisualCensus, VISUAL_DATE } from './fixtures/censusVisualSeed';

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`updates census labs and reviews a result at ${viewport.width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await seedVisualCensus(page);
    // Persist an entirely synthetic SDK user as well as the app's existing preview actor.
    // The gateway below is mocked; no request can reach production Firebase or a patient source.
    await page.addInitScript(() => {
      const token = [
        btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
        btoa(
          JSON.stringify({
            sub: 'preview',
            user_id: 'preview',
            aud: 'demo-hhr-e2e',
            email: 'preview@example.test',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
          })
        ),
        'synthetic',
      ].join('.');
      localStorage.setItem(
        'firebase:authUser:demo-api-key:[DEFAULT]',
        JSON.stringify({
          uid: 'preview',
          email: 'preview@example.test',
          emailVerified: true,
          isAnonymous: false,
          providerData: [],
          stsTokenManager: {
            accessToken: token,
            refreshToken: 'synthetic',
            expirationTime: Date.now() + 3600_000,
          },
          apiKey: 'demo-api-key',
          appName: '[DEFAULT]',
        })
      );
    });
    await page.route('**/identitytoolkit.googleapis.com/**', route =>
      route.fulfill({
        json: {
          users: [
            {
              localId: 'preview',
              email: 'preview@example.test',
              emailVerified: true,
              providerUserInfo: [],
            },
          ],
        },
      })
    );
    await page.route('**/firestore.googleapis.com/**', route => route.abort());
    let created = false,
      finished = false,
      reviewed = false;
    const entry = {
      id: 'synthetic-report',
      subjectKey: '12345678:visual-episode',
      revision: 'synthetic-revision',
      detectedAt: '2026-04-03T15:00:00Z',
      reviewedAt: null,
      exam: {
        id: '123',
        link: 'hhr-syslab-remote://report/synthetic',
        date: '03/04/2026',
        time: '09:00',
        exams: ['GLUCOSA'],
        origin: 'TEST',
        patientName: '',
      },
      findings: [
        {
          section: 'BIOQUIMICA',
          analysis: 'Glucosa',
          result: '90',
          unit: 'mg/dL',
          refValue: '70 - 100',
        },
      ],
    };
    await page.route('**/.netlify/functions/syslab-proxy?*', async route => {
      const action = new URL(route.request().url()).searchParams.get('action');
      expect(route.request().headers().authorization).toMatch(/^Bearer /);
      if (action === 'job-create') {
        const input = route.request().postDataJSON();
        expect(input.patients[0].rutBody).toBe('12345678');
        expect(input.patients[0].episodeId).toBe('visual-episode');
        expect(input.censusDate).toBe(VISUAL_DATE);
        expect(input.dateRange).toEqual({ from: '2026-03-01', to: VISUAL_DATE });
        created = true;
        return route.fulfill({
          status: 202,
          json: { success: true, job: { id: 'synthetic-job' } },
        });
      }
      if (action === 'census-review') {
        expect(route.request().postDataJSON()).toEqual({ id: entry.id, revision: entry.revision });
        reviewed = true;
        return route.fulfill({ json: { success: true } });
      }
      return route.fulfill({
        json: {
          success: true,
          entries: created && finished && !reviewed ? [entry] : [],
          unread: created && finished && !reviewed ? 1 : 0,
          nextOffset: null,
          jobs: created
            ? [
                {
                  id: 'synthetic-job',
                  kind: 'census',
                  status: finished ? 'completed' : 'running',
                  createdAt: entry.detectedAt,
                  completed: finished ? 2 : 0,
                  total: 2,
                  errors: [],
                  patients: [],
                },
              ]
            : [],
        },
      });
    });
    await page.goto(`/censo?date=${VISUAL_DATE}`);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Más opciones del censo' }).click();
    await page.getByTestId('census-laboratory-menu-entry').click();
    const inbox = page.getByTestId('census-laboratory-inbox');
    await expect(
      inbox.getByRole('button', { name: 'Actualizar exámenes del censo' })
    ).toBeEnabled();
    await expect(inbox.getByText('0 informes sin revisar')).toBeVisible();
    await expect(
      inbox.getByText(`desde el ingreso de cada paciente hasta ${VISUAL_DATE}`, { exact: false })
    ).toBeVisible();
    await inbox.getByRole('combobox', { name: 'Tipo de período' }).selectOption('custom');
    await inbox.getByLabel('Desde', { exact: true }).fill('2026-03-01');
    await inbox.getByLabel('Hasta', { exact: true }).fill('2026-02-01');
    await expect(inbox.getByRole('alert')).toContainText('Desde debe ser anterior');
    await expect(
      inbox.getByRole('button', { name: 'Actualizar exámenes del censo' })
    ).toBeDisabled();
    await inbox.getByLabel('Hasta', { exact: true }).fill(VISUAL_DATE);
    await inbox.getByRole('button', { name: 'Aplicar período' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      inbox.getByText(`Período aplicado: 2026-03-01 → ${VISUAL_DATE}`, { exact: false })
    ).toBeVisible();
    await inbox.getByRole('button', { name: 'Actualizar exámenes del censo' }).click();
    await expect(inbox.getByText(/En curso/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(inbox).toHaveCount(0);
    finished = true;
    await page.getByRole('button', { name: 'Más opciones del censo' }).click();
    await page.getByTestId('census-laboratory-menu-entry').click();
    await expect(inbox.getByLabel('Desde', { exact: true })).toHaveValue('2026-03-01');
    await expect(inbox.getByText('1 informe sin revisar')).toBeVisible();
    await inbox.getByRole('button', { name: 'Ver resultado' }).click();
    await expect(inbox.getByRole('cell', { name: '90 mg/dL' })).toBeVisible();
    await inbox.screenshot({ path: info.outputPath(`laboratory-inbox-${viewport.width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await inbox.getByRole('button', { name: 'Marcar revisado' }).focus();
    await page.keyboard.press('Enter');
    await expect(inbox.getByText('0 informes sin revisar')).toBeVisible();
    expect(errors).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(inbox).toHaveCount(0);
  });
}
