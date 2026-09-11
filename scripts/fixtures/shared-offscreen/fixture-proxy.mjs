import { createServer } from 'node:http';

const FIXTURE_URL = 'http://10.4.69.90/syslab/';

/** A fixture server speaking HTTP proxy syntax. It NEVER opens upstream sockets.
 * Works for Chromium offscreen targets even when Playwright detaches them.
 * Counters deliberately retain no URLs, headers, request bodies, or identifiers.
 */
export async function startFixtureProxy({ fixtureHtml }) {
  const network = {
    fixtureDocuments: 0, blocked: 0, unexpectedSyslab: 0,
    blockedHttp: 0, blockedConnect: 0, blockedUpgrade: 0, malformed: 0,
  };
  const sockets = new Set();
  const countBlocked = (request, kind) => {
    network.blocked += 1;
    network[kind] += 1;
    try {
      const url = new URL(request.url);
      if (url.hostname === '10.4.69.90') network.unexpectedSyslab += 1;
    } catch {
      if (request.url?.startsWith('10.4.69.90:')) network.unexpectedSyslab += 1;
    }
  };
  const server = createServer((request, response) => {
    request.resume(); // Discard bodies, never retain or forward them.
    if (request.method === 'GET' && request.url === FIXTURE_URL) {
      network.fixtureDocuments += 1;
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'close',
      });
      response.end(fixtureHtml);
      return;
    }
    countBlocked(request, 'blockedHttp');
    response.writeHead(403, { 'Content-Type': 'text/plain', Connection: 'close' });
    response.end('Blocked by synthetic fixture proxy');
  });
  const rejectSocket = (request, socket, kind) => {
    countBlocked(request, kind);
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  };
  server.on('connect', (request, socket) => rejectSocket(request, socket, 'blockedConnect'));
  server.on('upgrade', (request, socket) => rejectSocket(request, socket, 'blockedUpgrade'));
  server.on('clientError', (_error, socket) => {
    network.blocked += 1;
    network.malformed += 1;
    socket.destroy();
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setTimeout(5000, () => socket.destroy());
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  let closing;
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    network,
    close() {
      if (!closing) {
        closing = new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
          for (const socket of sockets) socket.destroy();
        });
      }
      return closing;
    },
  };
}
