import { expect, test } from '@playwright/test';
import { waitForAuthSurface } from './fixtures/auth';

test.describe('Authentication fixture visible alternatives', () => {
  test('accepts the authenticated main while the earlier login node is hidden', async ({
    page,
  }) => {
    test.setTimeout(5000);
    await page.setContent(
      '<button data-testid="login-google-button" hidden>Login</button><main>Census</main>'
    );
    await waitForAuthSurface(page);
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('accepts login while the earlier authenticated main is hidden', async ({ page }) => {
    test.setTimeout(5000);
    await page.setContent(
      '<main hidden>Census</main><button data-testid="login-google-button">Login</button>'
    );
    await waitForAuthSurface(page);
    await expect(page.getByTestId('login-google-button')).toBeVisible();
  });
});
