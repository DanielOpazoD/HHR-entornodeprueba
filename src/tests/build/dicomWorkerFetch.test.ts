// @vitest-environment node
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { request } from '@playwright/test';
import { expect, it } from 'vitest';
import { fetchDicomWorker } from '../../../e2e/fixtures/dicomWorkerFetch';

const withWorkerServer = async (
  resets: number,
  method: string,
  status: number,
  verify: (
    fetchWorker: () => ReturnType<typeof fetchDicomWorker>,
    count: () => number
  ) => Promise<void>
) => {
  let attempts = 0;
  const server = createServer((req, res) => {
    attempts += 1;
    if (attempts <= resets) {
      req.socket.destroy();
      return;
    }
    res.writeHead(status, { 'Content-Type': 'application/javascript' });
    res.end('/* synthetic worker */');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = await request.newContext();
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/worker.js`;
  try {
    await verify(
      () =>
        fetchDicomWorker({
          request: () => ({ method: () => method }),
          fetch: options => client.fetch(url, { ...options, method }),
        }),
      () => attempts
    );
  } finally {
    await client.dispose();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
};

it('recovers a transient worker GET reset through the real Playwright transport', async () => {
  await withWorkerServer(1, 'GET', 200, async (fetchWorker, count) => {
    const response = await fetchWorker();
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe('/* synthetic worker */');
    expect(count()).toBe(2);
  });
});
it('fails persistent resets after exactly two retries', async () => {
  await withWorkerServer(Infinity, 'GET', 200, async (fetchWorker, count) => {
    await expect(fetchWorker()).rejects.toThrow(/ECONNRESET|socket hang up/);
    expect(count()).toBe(3);
  });
});
it('preserves an HTTP failure without retrying it', async () => {
  await withWorkerServer(0, 'GET', 503, async (fetchWorker, count) => {
    expect((await fetchWorker()).status()).toBe(503);
    expect(count()).toBe(1);
  });
});
it('does not retry a non-GET request', async () => {
  await withWorkerServer(Infinity, 'POST', 200, async (fetchWorker, count) => {
    await expect(fetchWorker()).rejects.toThrow(/ECONNRESET|socket hang up/);
    expect(count()).toBe(1);
  });
});
