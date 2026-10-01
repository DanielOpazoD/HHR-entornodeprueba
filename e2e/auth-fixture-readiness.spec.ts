import { expect, test } from '@playwright/test';
import { waitForAuthSurface } from './fixtures/auth';

test.describe('Authentication fixture visible alternatives', () => {
  test('accepts the authenticated user menu while the earlier login node is hidden', async ({
    page,
  }) => {
    test.setTimeout(5000);
    await page.setContent(
      '<button data-testid="login-google-button" hidden>Login</button><main><button data-testid="authenticated-user-menu-button">User</button></main>'
    );
    await waitForAuthSurface(page);
    await expect(page.getByTestId('authenticated-user-menu-button')).toBeVisible();
  });

  test('waits through a visible shell until the user marker mounts', async ({ page }) => {
    test.setTimeout(5000);
    await page.setContent('<main>Loading census</main>');
    const readiness = waitForAuthSurface(page).then(() =>
      page.getByTestId('authenticated-user-menu-button').isVisible()
    );
    // Model an asynchronous UI transition; capture visibility at completion,
    // rather than letting a later assertion hide premature fixture readiness.
    await page.evaluate(
      () =>
        new Promise<void>(resolve => {
          setTimeout(() => {
            document.querySelector('main')!.innerHTML =
              '<button data-testid="authenticated-user-menu-button">User</button>';
            resolve();
          }, 100);
        })
    );
    expect(await readiness).toBe(true);
  });

  test('accepts login while the earlier authenticated user menu is hidden', async ({ page }) => {
    test.setTimeout(5000);
    await page.setContent(
      '<main hidden><button data-testid="authenticated-user-menu-button">User</button></main><button data-testid="login-google-button">Login</button>'
    );
    await waitForAuthSurface(page);
    await expect(page.getByTestId('login-google-button')).toBeVisible();
  });
});
