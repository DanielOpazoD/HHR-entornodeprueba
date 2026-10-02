import { describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { bootstrapSeededRecord, setupE2EContext } from '../../../e2e/fixtures/auth';

const fixturePage = () => {
  const surface = { waitFor: vi.fn().mockResolvedValue(undefined) };
  const census = {};
  const filter = vi.fn().mockReturnValue({ first: () => surface });
  const login = {
    isVisible: vi.fn().mockResolvedValue(false),
    or: vi.fn().mockReturnValue({ filter }),
  };
  const page = {
    addInitScript: vi.fn(),
    goto: vi.fn(),
    evaluate: vi.fn(),
    reload: vi.fn(),
    waitForLoadState: vi.fn().mockImplementation(async state => {
      if (state === 'networkidle') throw new Error('Firestore connection is still open');
    }),
    getByTestId: vi
      .fn()
      .mockImplementation(id => (id === 'authenticated-user-menu-button' ? census : login)),
    getByRole: vi.fn(),
  };
  return { page: page as unknown as Page, surface, census, login, filter };
};

describe.each([
  ['context', (page: Page) => setupE2EContext(page, 'admin')],
  ['seeded record', (page: Page) => bootstrapSeededRecord(page, { record: {} })],
] as const)('%s fixture readiness', (_name, bootstrap) => {
  it('requires a visible login or authenticated surface without waiting for network silence', async () => {
    const { page, surface, census, login, filter } = fixturePage();
    await bootstrap(page);
    expect(page.getByTestId).toHaveBeenCalledWith('authenticated-user-menu-button');
    expect(login.or).toHaveBeenCalledWith(census);
    expect(filter).toHaveBeenCalledWith({ visible: true });
    expect(surface.waitFor).toHaveBeenCalledWith({ state: 'visible', timeout: 15000 });
    expect(page.waitForLoadState).not.toHaveBeenCalledWith('networkidle', expect.anything());
  });

  it('fails when no auth surface becomes visible instead of swallowing the timeout', async () => {
    const { page, surface } = fixturePage();
    surface.waitFor.mockRejectedValue(new Error('Auth UI never mounted'));
    await expect(bootstrap(page)).rejects.toThrow('Auth UI never mounted');
  });
});
