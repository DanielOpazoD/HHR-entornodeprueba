// @vitest-environment node
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const functions = require('firebase-functions/v1');
const requireFromFunctions = createRequire(require.resolve('firebase-functions/v1'));
const express = requireFromFunctions('express');
const {
  createSantiagoAccountFunction,
} = require('../../../functions/lib/accounts/accountSantiagoFunction.js');

const withCallableServer = async (
  handler: (data: unknown, context: { rawRequest: { get: (header: string) => string } }) => unknown,
  verify: (endpoint: string) => Promise<void>
) => {
  const app = express();
  app.use(express.json());
  app.use(createSantiagoAccountFunction(functions.https.onCall(handler)));
  const server = createServer(app);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a bound local port');
    await verify(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
};

const origin = 'http://localhost:3904';
const post = (endpoint: string, body: unknown) =>
  fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'X-Synthetic-Test': 'preserved',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });

describe('Santiago Gen2 adapter with the real Gen1 callable protocol', () => {
  it('preserves callable data, response serialization, rawRequest and CORS', async () => {
    const handler = vi.fn((data, context) => ({
      received: data,
      requestHeader: context.rawRequest.get('X-Synthetic-Test'),
    }));
    await withCallableServer(handler, async endpoint => {
      const response = await post(endpoint, { data: { synthetic: true } });
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
      expect(await response.json()).toEqual({
        result: { received: { synthetic: true }, requestHeader: 'preserved' },
      });
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  it('preserves preflight handling without invoking the credential handler', async () => {
    const handler = vi.fn();
    await withCallableServer(handler, async endpoint => {
      const response = await fetch(endpoint, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
        signal: AbortSignal.timeout(5000),
      });
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
      expect(response.headers.get('access-control-allow-methods')).toBe('POST');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  it('rejects malformed callable input before invoking the handler', async () => {
    const handler = vi.fn();
    await withCallableServer(handler, async endpoint => {
      const response = await post(endpoint, { unexpected: 'synthetic' });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { status: 'INVALID_ARGUMENT', message: 'Bad Request' },
      });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  it('rejects a malformed authorization header before invoking the credential handler', async () => {
    const handler = vi.fn();
    await withCallableServer(handler, async endpoint => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          Authorization: 'Invalid synthetic-authorization',
        },
        body: JSON.stringify({ data: {} }),
        signal: AbortSignal.timeout(5000),
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
      expect(await response.json()).toEqual({
        error: { status: 'UNAUTHENTICATED', message: 'Unauthenticated' },
      });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  it('preserves structured callable errors instead of changing the public protocol', async () => {
    const handler = vi.fn(() => {
      throw new functions.https.HttpsError('permission-denied', 'Synthetic account unavailable');
    });
    await withCallableServer(handler, async endpoint => {
      const response = await post(endpoint, { data: {} });
      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
      expect(await response.json()).toEqual({
        error: { status: 'PERMISSION_DENIED', message: 'Synthetic account unavailable' },
      });
      expect(handler).toHaveBeenCalledOnce();
    });
  });
});
