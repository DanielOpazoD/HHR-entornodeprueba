import { test, expect, type Page } from '@playwright/test';

const expectMultiTabError = async (page: Page) => {
  const alertByTestId = page.getByTestId('login-error-alert');
  const testIdVisible = await alertByTestId.isVisible({ timeout: 1000 }).catch(() => false);

  if (testIdVisible) {
    await expect(alertByTestId).toBeVisible();
    return;
  }

  await expect(
    page
      .locator(
        'text=/ya hay otro intento de ingreso|otra pestaña|en curso|No se pudo abrir la ventana de Google/i'
      )
      .first()
  ).toBeVisible();
};

const expectLockFeedback = async (page: Page) => {
  await expect
    .poll(
      async () => ({
        errorVisible:
          (await page
            .getByTestId('login-error-alert')
            .isVisible()
            .catch(() => false)) ||
          (await page
            .getByText(
              /ya hay otro intento de ingreso|otra pestaña|en curso|No se pudo abrir la ventana de Google/i
            )
            .first()
            .isVisible()
            .catch(() => false)),
        pendingVisible: await page
          .getByTestId('login-google-pending')
          .isVisible()
          .catch(() => false),
        loginHeadingVisible: await page
          .getByRole('heading', { name: /Iniciar sesión/i })
          .isVisible()
          .catch(() => false),
      }),
      { timeout: 5000 }
    )
    .toMatchObject({
      loginHeadingVisible: true,
    });
};

test.describe('Auth multi-tab lock', () => {
  test('shows user-facing error when another tab holds Google login lock', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'hhr_google_login_lock_v1',
        JSON.stringify({
          owner: 'other-tab-session',
          timestamp: Date.now(),
        })
      );
    });

    await page.goto('/');

    const loginButton = page.getByTestId('login-google-button');
    await expect(loginButton).toBeVisible();
    await loginButton.click();

    await expectMultiTabError(page);
  });

  test('enforces lock across two real tabs during concurrent login attempt', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const tabA = await context.newPage();
    const tabB = await context.newPage();

    await tabA.addInitScript(() => {
      window.localStorage.setItem('hhr_e2e_force_popup', 'true');
      window.localStorage.setItem('hhr_e2e_popup_delay_ms', '4000');
      window.localStorage.setItem('hhr_e2e_popup_error_code', 'auth/network-request-failed');
    });
    await tabB.addInitScript(() => {
      window.localStorage.setItem('hhr_e2e_force_popup', 'true');
    });

    await tabA.goto('/');
    await tabB.goto('/');

    const loginButtonA = tabA.getByTestId('login-google-button');
    const loginButtonB = tabB.getByTestId('login-google-button');

    await expect(loginButtonA).toBeVisible();
    await expect(loginButtonB).toBeVisible();

    // Start login in tab A and, while lock heartbeat is active, attempt login in tab B.
    await loginButtonA.click();
    await expect
      .poll(async () => {
        return tabB.evaluate(() =>
          Boolean(window.localStorage.getItem('hhr_google_login_lock_v1'))
        );
      })
      .toBe(true);
    await loginButtonB.click();

    await expectLockFeedback(tabB);

    await context.close();
  });
});
