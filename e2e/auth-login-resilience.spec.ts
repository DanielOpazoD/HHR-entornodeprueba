import { test, expect, type Page } from '@playwright/test';
import { bootstrapSeededRecord, buildCanonicalE2ERecord, clearAuth } from './fixtures/auth';
import type { SyncTask } from '../src/services/storage/syncQueueTypes';

const expectLoginError = async (page: Page, code: string) => {
  const alertByTestId = page.getByTestId('login-error-alert');

  const testIdVisible = await alertByTestId.isVisible({ timeout: 1000 }).catch(() => false);
  if (testIdVisible) {
    await expect(alertByTestId).toHaveAttribute('data-auth-error-code', code);
    return;
  }

  if (code === 'auth/popup-blocked' || code === 'auth/network-request-failed') {
    await expect
      .poll(
        async () => ({
          loginVisible: await page
            .getByTestId('login-google-button')
            .isVisible()
            .catch(() => false),
          pendingVisible: await page
            .getByTestId('login-google-pending')
            .isVisible()
            .catch(() => false),
        }),
        { timeout: 5000 }
      )
      .toMatchObject({
        loginVisible: true,
        pendingVisible: false,
      });
    return;
  }
};

const isNavigationContextReset = (error: unknown): boolean => {
  const message = String((error as Error)?.message || error);
  return (
    message.includes('Execution context was destroyed') ||
    message.includes('Cannot find context with specified id')
  );
};

const expectLoginIdle = async (page: Page) => {
  await expect
    .poll(
      async () =>
        page.evaluate(() => ({
          buttonVisible: Boolean(document.querySelector('[data-testid="login-google-button"]')),
          buttonDisabled:
            document
              .querySelector('[data-testid="login-google-button"]')
              ?.hasAttribute('disabled') ?? true,
          errorVisible: Boolean(document.querySelector('[data-testid="login-error-alert"]')),
          pendingVisible: Boolean(document.querySelector('[data-testid="login-google-pending"]')),
          pendingHint: window.sessionStorage.getItem('hhr_google_login_attempt_pending'),
        })),
      { timeout: 5000 }
    )
    .toMatchObject({
      buttonVisible: true,
      buttonDisabled: false,
      errorVisible: false,
      pendingVisible: false,
      pendingHint: null,
    });
};

test.describe('Auth login resilience matrix', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('hhr_e2e_force_popup', 'true');
    });
    await page.goto('/');
    await expect(page.getByTestId('login-google-button')).toBeVisible();
  });

  test('keeps RUT credential geometry while its functional module loads', async ({ page }) => {
    let releaseModule!: () => void;
    const moduleReady = new Promise<void>(resolve => {
      releaseModule = resolve;
    });
    await page.route('**/*LoginPage*', async route => {
      await moduleReady;
      await route.continue();
    });
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('login-loading-shell')).toBeVisible();
      const username = page.getByLabel('Usuario', { exact: true });
      const password = page.getByLabel('Contraseña', { exact: true });
      const submit = page.getByRole('button', { name: 'Ingresar', exact: true });
      await expect(username).toBeDisabled();
      const before = await Promise.all([
        username.boundingBox(),
        password.boundingBox(),
        submit.boundingBox(),
      ]);
      const wallpaper = await page.getByTestId('login-background-image').getAttribute('style');
      releaseModule();
      await expect(username).toBeEnabled();
      const after = await Promise.all([
        username.boundingBox(),
        password.boundingBox(),
        submit.boundingBox(),
      ]);
      for (let index = 0; index < before.length; index += 1) {
        const initial = before[index];
        const ready = after[index];
        expect(initial).not.toBeNull();
        expect(ready).not.toBeNull();
        if (!initial || !ready) throw new Error('Credential field was not rendered');
        for (const dimension of ['x', 'y', 'width', 'height'] as const) {
          expect(Math.abs(initial[dimension] - ready[dimension])).toBeLessThanOrEqual(2);
        }
      }
      await expect(page.getByTestId('login-background-image')).toHaveAttribute(
        'style',
        wallpaper || ''
      );
    } finally {
      releaseModule();
      await page.unroute('**/*LoginPage*');
    }
  });

  test('keeps entered RUT credentials when changing the decorative background', async ({
    page,
  }) => {
    const username = page.getByLabel('Usuario', { exact: true });
    const password = page.getByLabel('Contraseña', { exact: true });
    await expect(username).toBeEnabled();
    await username.fill('11.111.111-1');
    await password.fill('Synthetic example 1');
    await page.getByRole('button', { name: 'Mostrar contraseña' }).click();
    await page.getByRole('button', { name: 'Cambiar modo de fondo' }).click();
    await expect(username).toHaveValue('111111111');
    await expect(password).toHaveValue('Synthetic example 1');
    await expect(password).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeEnabled();
    const wallpaper = await page.getByTestId('login-page').getAttribute('data-background-image');
    await page.reload();
    await expect(username).toBeEnabled();
    await expect(username).toHaveValue('');
    await expect(password).toHaveValue('');
    await expect(page.getByTestId('login-page')).toHaveAttribute(
      'data-background-image',
      wallpaper || ''
    );
  });

  test('preserves compact login geometry after reload with an accessible icon-only Google action', async ({
    page,
  }) => {
    await expect(
      page.getByText('Ingresa con tu RUT o cuenta institucional para continuar.')
    ).toHaveCount(0);
    await expect(page.getByText('Información clínica disponible cuando la necesitas.')).toHaveCount(
      0
    );
    const google = page.getByRole('button', { name: 'Ingresar con Google', exact: true });
    await expect(google).toBeVisible();
    await expect(google).toHaveText('');
    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1024, height: 600 },
      { width: 375, height: 667 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      const serviceName = page
        .getByText('Servicio de Hospitalizados', { exact: true })
        .filter({ visible: true });
      await expect(serviceName).toBeVisible();
      const fields = page.locator('input');
      const beforeReload = await fields.evaluateAll(elements =>
        elements.map(element => element.getBoundingClientRect().toJSON())
      );
      await page.reload();
      await expect(page.getByLabel('Usuario', { exact: true })).toBeEnabled();
      await expect(google).toBeVisible();
      await expect(google).toHaveText('');
      await expect(serviceName).toBeVisible();
      await expect
        .poll(() =>
          fields.evaluateAll(elements =>
            elements.map(element => element.getBoundingClientRect().toJSON())
          )
        )
        .toEqual(beforeReload);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const root = document.documentElement;
            const footer = document.querySelector('.login-support-footer');
            return {
              horizontalOverflow: root.scrollWidth > root.clientWidth,
              verticalOverflow: root.scrollHeight > root.clientHeight,
              footerWithinViewport: Boolean(
                footer && footer.getBoundingClientRect().bottom <= root.clientHeight
              ),
            };
          })
        )
        .toEqual({
          horizontalOverflow: false,
          verticalOverflow: false,
          footerWithinViewport: true,
        });
    }
  });

  test('popup blocked surfaces a clear error and stays on login', async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem('hhr_e2e_popup_error_code', 'auth/popup-blocked');
    });

    await page.getByTestId('login-google-button').click();

    await expectLoginError(page, 'auth/popup-blocked');
    await expect(page.getByTestId('login-google-button')).toBeVisible();
  });

  test('network failure does not switch flows and keeps the user on login', async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem('hhr_e2e_popup_error_code', 'auth/network-request-failed');
    });

    await page.getByTestId('login-google-button').click();
    await expectLoginError(page, 'auth/network-request-failed');
    await expect(page.getByTestId('login-google-button')).toBeVisible();
  });

  test('closing the Google account picker returns to idle without a blocked-popup alert', async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.localStorage.setItem('hhr_e2e_popup_error_code', 'auth/popup-closed-by-user');
    });

    await page.getByTestId('login-google-button').click();

    await expectLoginIdle(page);
  });

  test('reload preserves local work and returns to a usable login', async ({ page: warmup }) => {
    const context = warmup.context();
    try {
      await bootstrapSeededRecord(warmup, {
        date: '2026-02-20',
        record: buildCanonicalE2ERecord('2026-02-20'),
        useRuntimeOverride: false,
        forceLocalOnlySync: true,
      });
      await warmup.goto('/census?date=2026-02-20');
      await expect(warmup.getByTestId('census-table')).toBeVisible({ timeout: 15000 });
      await expect
        .poll(() =>
          warmup.evaluate(async () =>
            (await indexedDB.databases()).some(db => db.name === 'HangaRoaDB')
          )
        )
        .toBe(true);
    } finally {
      await warmup.close();
    }
    const page = await context.newPage();
    await page.goto('/');
    await clearAuth(page);
    await page.reload();
    await expect(page.getByLabel('Usuario', { exact: true })).toBeEnabled();
    const pendingTask = {
      opId: 'synthetic-reload-unconfirmed',
      ownerKey: 'synthetic-reload-owner',
      type: 'UPDATE_DAILY_RECORD',
      payload: { date: '2026-02-20' },
      timestamp: Date.now(),
      retryCount: 3,
      status: 'FAILED',
      error: 'Synthetic validation failure',
    } satisfies SyncTask;
    const pendingId = await page.evaluate(
      task =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open('HangaRoaDB');
          request.onupgradeneeded = () => request.transaction?.abort();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('syncQueue', 'readwrite');
            const insert = tx.objectStore('syncQueue').add(task);
            tx.oncomplete = () => {
              db.close();
              if (typeof insert.result !== 'number') {
                reject(new Error('The synthetic queue task must have a numeric key'));
                return;
              }
              resolve(insert.result);
            };
            tx.onabort = tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          };
        }),
      pendingTask
    );
    await page.evaluate(async () => {
      localStorage.setItem('hhr_login_background_mode', 'night');
      localStorage.setItem('firebase:authUser:synthetic:[DEFAULT]', '{"uid":"synthetic"}');
      localStorage.setItem(
        'offlineQueue',
        JSON.stringify([{ key: 'synthetic-pending', status: 'FAILED' }])
      );
      sessionStorage.setItem('hhr_reload_note', 'keep-synthetic-note');
      const cache = await caches.open('hhr-reload-synthetic-cache');
      await cache.put('/hhr-reload-synthetic', new Response('synthetic'));
    });
    const before = await page.evaluate(() => performance.timeOrigin);
    await page.locator('summary').filter({ hasText: 'Ayuda de acceso' }).click();
    await page.getByTestId('login-reload-button').click();
    await page.getByRole('button', { name: 'Recargar aplicación', exact: true }).click();
    await expect
      .poll(async () => {
        try {
          return await page.evaluate(() => performance.timeOrigin);
        } catch (error) {
          if (!isNavigationContextReset(error)) throw error;
          return before;
        }
      })
      .toBeGreaterThan(before);
    // The synthetic Firebase hint allows the existing 15s rehydration budget.
    await expect(page.getByTestId('login-google-button')).toBeVisible({ timeout: 20000 });
    await expect(page.getByLabel('Usuario', { exact: true })).toBeEnabled();
    const restoredTask = await page.evaluate(
      id =>
        new Promise<unknown>((resolve, reject) => {
          const request = indexedDB.open('HangaRoaDB');
          request.onupgradeneeded = () => request.transaction?.abort();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('syncQueue', 'readonly');
            const read = tx.objectStore('syncQueue').get(id);
            tx.oncomplete = () => {
              db.close();
              resolve(read.result);
            };
            tx.onabort = tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          };
        }),
      pendingId
    );
    expect(restoredTask).toEqual({ ...pendingTask, id: pendingId });
    expect(
      await page.evaluate(async () => ({
        background: localStorage.getItem('hhr_login_background_mode'),
        auth: localStorage.getItem('firebase:authUser:synthetic:[DEFAULT]'),
        pending: JSON.parse(localStorage.getItem('offlineQueue') || 'null'),
        note: sessionStorage.getItem('hhr_reload_note'),
        cache: await (await caches.open('hhr-reload-synthetic-cache'))
          .match('/hhr-reload-synthetic')
          .then(response => response?.text()),
      }))
    ).toEqual({
      background: 'night',
      auth: '{"uid":"synthetic"}',
      pending: [{ key: 'synthetic-pending', status: 'FAILED' }],
      note: 'keep-synthetic-note',
      cache: 'synthetic',
    });
  });

  test('retry after transient popup failure succeeds', async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem('hhr_e2e_popup_error_code', 'auth/network-request-failed');
      window.localStorage.setItem(
        'hhr_e2e_popup_success_user',
        JSON.stringify({
          uid: 'e2e-popup-user',
          email: 'e2e.popup@hospital.cl',
          displayName: 'E2E Popup User',
          role: 'admin',
        })
      );
    });

    await page.getByTestId('login-google-button').click();
    await expectLoginError(page, 'auth/network-request-failed');

    await page.getByTestId('login-google-button').click();
    await expect
      .poll(
        async () =>
          page.evaluate(() => ({
            popupUserPending: window.localStorage.getItem('hhr_e2e_popup_success_user'),
            loginButtonVisible: Boolean(
              document.querySelector('[data-testid="login-google-button"]')
            ),
          })),
        { timeout: 12000 }
      )
      .toMatchObject({
        popupUserPending: null,
      });
  });
});
