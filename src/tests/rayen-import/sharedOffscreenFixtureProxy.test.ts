// @vitest-environment node
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { startFixtureProxy } from '../../../scripts/fixtures/shared-offscreen/fixture-proxy.mjs';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const start = async () => {
  const proxy = await startFixtureProxy({ fixtureHtml: '<html>synthetic-only</html>' });
  cleanups.push(() => proxy.close());
  return proxy;
};
const send = (proxyUrl: string, target: string, method = 'GET', headers = {}) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const proxy = new URL(proxyUrl);
    const req = request(
      { hostname: proxy.hostname, port: proxy.port, path: target, method, headers, agent: false },
      response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          body += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode!, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
const raw = async (proxyUrl: string, text: string) => {
  const proxy = new URL(proxyUrl);
  const socket = connect(Number(proxy.port), proxy.hostname);
  socket.setEncoding('utf8');
  let response = '';
  socket.on('data', chunk => {
    response += chunk;
  });
  const ended = once(socket, 'end');
  socket.end(text);
  await ended;
  return response;
};

describe('offscreen synthetic fixture HTTP proxy (real loopback sockets)', () => {
  it('serves only the exact absolute GET fixture URL and counts documents', async () => {
    const proxy = await start();
    expect(await send(proxy.url, 'http://10.4.69.90/syslab/')).toEqual({
      status: 200,
      body: '<html>synthetic-only</html>',
    });
    expect(proxy.network.fixtureDocuments).toBe(1);
    expect(proxy.network.blocked).toBe(0);
  });

  it.each([
    ['POST', 'http://10.4.69.90/syslab/'],
    ['HEAD', 'http://10.4.69.90/syslab/'],
    ['GET', 'http://10.4.69.90/syslab/?query=synthetic'],
    ['GET', 'http://10.4.69.90/syslab/detalleexamenes.php'],
    ['GET', 'http://10.4.69.90/syslab/../syslab/'],
    ['GET', 'http://10.4.69.90:80/syslab/'],
    ['GET', 'http://user@10.4.69.90/syslab/'],
    ['GET', 'https://10.4.69.90/syslab/'],
    ['GET', 'http://10.4.69.90.evil.invalid/syslab/'],
    ['GET', '/syslab/'],
  ])('rejects %s %s without interpreting Host as an allowlist bypass', async (method, target) => {
    const proxy = await start();
    expect((await send(proxy.url, target, method, { Host: '10.4.69.90' })).status).toBe(403);
    expect(proxy.network.fixtureDocuments).toBe(0);
    expect(proxy.network.blockedHttp).toBe(1);
    expect(proxy.network.blocked).toBe(1);
  });

  it('never forwards HTTP or tunnels CONNECT, even to an available local upstream', async () => {
    let connections = 0;
    const upstream = createServer((_request, response) => response.end('must not be reached'));
    upstream.on('connection', () => {
      connections += 1;
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) =>
          upstream.close(error => (error ? reject(error) : resolve()))
        )
    );
    const address = upstream.address() as { port: number };
    const authority = `127.0.0.1:${address.port}`;
    const proxy = await start();
    expect((await send(proxy.url, `http://${authority}/`)).status).toBe(403);
    expect(
      await raw(proxy.url, `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`)
    ).toMatch(/^HTTP\/1.1 403 Forbidden/);
    expect(connections).toBe(0);
    expect(proxy.network.blockedHttp).toBe(1);
    expect(proxy.network.blockedConnect).toBe(1);
  });

  it('rejects Syslab CONNECT and websocket upgrades with payload-free counters', async () => {
    const proxy = await start();
    expect(
      await raw(proxy.url, 'CONNECT 10.4.69.90:443 HTTP/1.1\r\nHost: 10.4.69.90\r\n\r\n')
    ).toMatch(/^HTTP\/1.1 403 Forbidden/);
    expect(
      await raw(
        proxy.url,
        'GET http://10.4.69.90/syslab/ HTTP/1.1\r\nHost: 10.4.69.90\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'
      )
    ).toMatch(/^HTTP\/1.1 403 Forbidden/);
    expect(proxy.network).toMatchObject({
      fixtureDocuments: 0,
      blocked: 2,
      blockedConnect: 1,
      blockedUpgrade: 1,
      unexpectedSyslab: 2,
    });
    expect(Object.values(proxy.network).every(value => typeof value === 'number')).toBe(true);
  });

  it('closes idle sockets and listener, and cleanup is idempotent', async () => {
    const proxy = await start();
    const address = new URL(proxy.url);
    const idle = connect(Number(address.port), address.hostname);
    await once(idle, 'connect');
    // Forced shutdown may produce FIN or ECONNRESET depending on the OS.
    const errors: string[] = [];
    idle.on('error', error => errors.push((error as NodeJS.ErrnoException).code || 'unknown'));
    const closed = new Promise<void>(resolve => idle.once('close', () => resolve()));
    await proxy.close();
    await closed;
    expect(errors.every(code => code === 'ECONNRESET')).toBe(true);
    await proxy.close();
    await expect(send(proxy.url, 'http://10.4.69.90/syslab/')).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
  });
});
