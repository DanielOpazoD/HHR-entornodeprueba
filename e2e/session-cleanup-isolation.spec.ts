import { expect, test } from '@playwright/test';

// A fresh, unauthenticated browser context exercises the real storage service
// and native Web Locks, without touching the user's Chrome data or Firebase.
test('a second document waits for logout and survives a stale cleanup', async ({ browser }) => {
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return host === 'localhost' || host === '127.0.0.1' ? route.continue() : route.abort();
  });
  const first = await context.newPage();
  const second = await context.newPage();
  const service = '/src/services/storage/sessionScopedStorageService.ts';
  try {
    await first.goto('http://localhost:3000/');
    await second.goto('http://localhost:3000/');
    await first.evaluate(async modulePath => {
      const api = await import(modulePath);
      await api.reconcileAuthorizedSessionOwner('user:synthetic');
      localStorage.setItem(
        'test:old-generation',
        localStorage.getItem('hhr_session_generation_v1')!
      );
      void api
        .clearSessionScopedClientState(
          'manual',
          () =>
            new Promise<void>(resolve => {
              window.addEventListener('test:finish-cleanup', () => resolve(), { once: true });
            })
        )
        .then(() => localStorage.setItem('test:closed', 'yes'));
    }, service);
    await expect
      .poll(() =>
        second.evaluate(async () =>
          (await navigator.locks.query()).held?.some(
            lock => lock.name === 'hhr-session-storage-transition'
          )
        )
      )
      .toBe(true);
    await second.evaluate(async modulePath => {
      const api = await import(modulePath);
      void api.reconcileAuthorizedSessionOwner('user:synthetic').then(() => {
        localStorage.setItem('hhr_new_session_data', 'keep');
        localStorage.setItem('test:admitted', 'yes');
      });
    }, service);
    await expect
      .poll(() =>
        second.evaluate(async () =>
          (await navigator.locks.query()).pending?.some(
            lock => lock.name === 'hhr-session-storage-transition'
          )
        )
      )
      .toBe(true);
    expect(await second.evaluate(() => localStorage.getItem('test:admitted'))).toBeNull();
    await first.evaluate(() => window.dispatchEvent(new Event('test:finish-cleanup')));
    await expect
      .poll(() => second.evaluate(() => localStorage.getItem('test:admitted')))
      .toBe('yes');
    await first.evaluate(async modulePath => {
      const api = await import(modulePath);
      await api.clearSessionScopedClientState(
        'manual',
        async () => {},
        localStorage.getItem('test:old-generation')
      );
    }, service);
    expect(await second.evaluate(() => localStorage.getItem('hhr_new_session_data'))).toBe('keep');
    await second.reload();
    expect(await second.evaluate(() => localStorage.getItem('hhr_new_session_data'))).toBe('keep');
  } finally {
    await context.close();
  }
});
