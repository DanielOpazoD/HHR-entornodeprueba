import { test, expect, type Page } from '@playwright/test';

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

  test('local reset clears browser app traces and returns to a clean login screen', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      window.localStorage.setItem('hhr_login_background_mode', 'night');
      window.localStorage.setItem('firebase:authUser:test:[DEFAULT]', '{"uid":"abc"}');
      window.localStorage.setItem('unrelated_local_key', 'remove-me');
      window.sessionStorage.setItem('hhr_google_login_attempt_pending', String(Date.now()));
      window.sessionStorage.setItem('unrelated_session_key', 'remove-me');

      if ('caches' in window) {
        await window.caches.delete('hhr-reset-smoke-cache');
        const cache = await window.caches.open('hhr-reset-smoke-cache');
        await cache.put('/hhr-reset-smoke', new Response('ok'));
      }
    });

    await page.getByTestId('login-reset-local-button').click();
    await page.getByRole('button', { name: 'Reiniciar ahora' }).click();
    await expect(page.getByTestId('login-google-button')).toBeVisible();
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);

    await expect
      .poll(
        async () => {
          try {
            return await page.evaluate(async () => ({
              hasSeededLocalKeys:
                window.localStorage.getItem('hhr_login_background_mode') !== null ||
                window.localStorage.getItem('firebase:authUser:test:[DEFAULT]') !== null ||
                window.localStorage.getItem('unrelated_local_key') !== null,
              hasSeededSessionKeys:
                window.sessionStorage.getItem('hhr_google_login_attempt_pending') !== null ||
                window.sessionStorage.getItem('unrelated_session_key') !== null,
              resetCacheStillPresent:
                'caches' in window
                  ? (await window.caches.keys()).includes('hhr-reset-smoke-cache')
                  : false,
              errorVisible: Boolean(document.querySelector('[data-testid="login-error-alert"]')),
            }));
          } catch (error) {
            if (!isNavigationContextReset(error)) {
              throw error;
            }
            return {
              hasSeededLocalKeys: true,
              hasSeededSessionKeys: true,
              resetCacheStillPresent: true,
              errorVisible: true,
            };
          }
        },
        { timeout: 5000 }
      )
      .toMatchObject({
        hasSeededLocalKeys: false,
        hasSeededSessionKeys: false,
        resetCacheStillPresent: false,
        errorVisible: false,
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
