// @vitest-environment node
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueInstanceTicket } from '../../../netlify/functions/lib/mmrad-dicom-policy';
import { sealShareAccess } from '../../../netlify/functions/lib/mmrad-universitas';
import {
  SYNTHETIC_SERIES_UID,
  SYNTHETIC_STUDY_UID,
  syntheticDicom,
  syntheticSopUid,
} from '../fixtures/syntheticDicom';

const require = createRequire(import.meta.url);
const requireFromFunctions = createRequire(require.resolve('firebase-functions/v1'));
const express = requireFromFunctions('express');
const {
  createMmradDicomSantiagoFunction,
} = require('../../../functions/lib/mmrad/mmradDicomSantiagoFunction.js');

// Synthetic session, cookie, user and token; the upstream is always a local mock.
const SESSION = '0123456789abcdef01234567';
const COOKIE = `cc_public_share_${SESSION}=synthetic-cookie-value`;
const SUBJECT = 'synthetic-user';
const ORIGIN = 'https://hhr-hospitalizados.app';
const ORIGINAL = syntheticDicom(0, 1);
const WADO_URL =
  'https://visorammym.mmrad.cl/api/public/wado/HHANGAROA?' +
  new URLSearchParams({
    requestType: 'WADO',
    studyUID: SYNTHETIC_STUDY_UID,
    seriesUID: SYNTHETIC_SERIES_UID,
    objectUID: syntheticSopUid(0),
    contentType: 'application/dicom',
    shareSession: SESSION,
  });

const ticketFor = (patch: Record<string, unknown> = {}, ttlMs = 9 * 60_000) =>
  issueInstanceTicket(
    {
      subject: SUBJECT,
      study: SYNTHETIC_STUDY_UID,
      series: SYNTHETIC_SERIES_UID,
      sop: syntheticSopUid(0),
      server: 'HHANGAROA',
      viewer: 'universitas',
      session: sealShareAccess({ session: SESSION, cookie: COOKIE }),
      ...patch,
    },
    ttlMs
  );

const dependencies = (overrides: Record<string, unknown> = {}) => ({
  verifyIdToken: vi.fn(async (token: string) => {
    if (token !== 'synthetic-id-token') throw new Error('synthetic invalid token');
    return { uid: SUBJECT, sub: SUBJECT, email: ' Clinico@Example.TEST ' };
  }),
  resolveRoleForEmail: vi.fn(async () => 'doctor_urgency'),
  fetchImpl: vi.fn(
    async () =>
      new Response(ORIGINAL, {
        headers: {
          'Content-Type': 'application/dicom',
          'Content-Length': String(ORIGINAL.length),
        },
      })
  ),
  isRateLimited: vi.fn(() => false),
  ...overrides,
});

const withFunction = async (
  deps: ReturnType<typeof dependencies>,
  verify: (endpoint: string) => Promise<void>
) => {
  const app = express();
  // Cloud Functions parses JSON bodies and keeps the raw bytes, as here.
  app.use(
    express.json({
      verify: (req: { rawBody?: Buffer }, _res: unknown, buffer: Buffer) => {
        req.rawBody = buffer;
      },
    })
  );
  app.use(createMmradDicomSantiagoFunction(deps));
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

const post = (
  endpoint: string,
  body: unknown,
  { origin = ORIGIN, authorization = 'Bearer synthetic-id-token' } = {}
) =>
  fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

describe('mmradDicomSantiago: full MMRAD originals from Santiago', () => {
  beforeEach(() => vi.stubEnv('MMRAD_PASSWORD', 'synthetic-test-secret'));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('is declared in Santiago with the MMRAD secret and room for a 30 MB original', () => {
    vi.stubEnv('GCLOUD_PROJECT', 'demo-hhr-radiology');
    expect(createMmradDicomSantiagoFunction(dependencies()).__endpoint).toMatchObject({
      platform: 'gcfv2',
      region: ['southamerica-west1'],
      serviceAccountEmail: 'demo-hhr-radiology@appspot.gserviceaccount.com',
      secretEnvironmentVariables: [{ key: 'MMRAD_PASSWORD' }],
      availableMemoryMb: 1024,
      timeoutSeconds: 180,
      maxInstances: 10,
      minInstances: 0,
      httpsTrigger: {},
    });
  });

  it('answers the preflight of HHR origins only', async () => {
    const deps = dependencies();
    await withFunction(deps, async endpoint => {
      const preflight = (origin: string) =>
        fetch(endpoint, {
          method: 'OPTIONS',
          headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'authorization,content-type',
          },
        });
      for (const origin of [
        ORIGIN,
        'https://testinghhr.netlify.app',
        'https://deploy-preview-1186--testinghhr.netlify.app',
      ]) {
        const response = await preflight(origin);
        expect(response.status, origin).toBe(204);
        expect(response.headers.get('access-control-allow-origin')).toBe(origin);
        expect(response.headers.get('access-control-allow-headers')).toMatch(/Authorization/);
      }
      for (const origin of [
        'https://evil.example',
        'https://deploy-preview-1--other-site.netlify.app',
        'https://testinghhr.netlify.app.evil.example',
      ]) {
        const response = await preflight(origin);
        expect(response.status, origin).toBe(403);
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
      }
      const foreign = await post(
        endpoint,
        { ticket: ticketFor() },
        { origin: 'https://evil.example' }
      );
      expect(foreign.status).toBe(403);
      expect(deps.verifyIdToken).not.toHaveBeenCalled();
      expect(deps.fetchImpl).not.toHaveBeenCalled();
    });
  });

  it('requires a Firebase session whose role may use radiology', async () => {
    await withFunction(dependencies(), async endpoint => {
      expect((await post(endpoint, { ticket: ticketFor() }, { authorization: '' })).status).toBe(
        401
      );
      expect(
        (await post(endpoint, { ticket: ticketFor() }, { authorization: 'Bearer forged' })).status
      ).toBe(401);
    });
    const denied = dependencies({ resolveRoleForEmail: vi.fn(async () => 'unauthorized') });
    await withFunction(denied, async endpoint => {
      expect((await post(endpoint, { ticket: ticketFor() })).status).toBe(403);
      expect(denied.resolveRoleForEmail).toHaveBeenCalledWith('clinico@example.test', {
        auth: { uid: SUBJECT, token: expect.objectContaining({ sub: SUBJECT }) },
      });
    });
    const unavailable = dependencies({
      resolveRoleForEmail: vi.fn(async () => {
        throw new Error('synthetic Firestore outage');
      }),
    });
    await withFunction(unavailable, async endpoint => {
      expect((await post(endpoint, { ticket: ticketFor() })).status).toBe(503);
    });
    const noEmail = dependencies({
      verifyIdToken: vi.fn(async () => ({ uid: SUBJECT, sub: SUBJECT })),
    });
    await withFunction(noEmail, async endpoint => {
      expect((await post(endpoint, { ticket: ticketFor() })).status).toBe(401);
    });
    for (const deps of [denied, unavailable, noEmail])
      expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('returns the full original of a ticket that mmrad-dicom issued, from the fixed viewer host', async () => {
    const deps = dependencies();
    await withFunction(deps, async endpoint => {
      const response = await post(endpoint, { ticket: ticketFor() });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/dicom');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      expect(response.headers.get('access-control-expose-headers')).toMatch(/Server-Timing/);
      expect(response.headers.get('server-timing')).toMatch(/^auth;dur=[\d.]+, upstream;dur=/);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(ORIGINAL);
    });
    expect(deps.fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = deps.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(WADO_URL);
    expect(init).toMatchObject({
      redirect: 'error',
      headers: { Cookie: COOKIE, Accept: 'application/dicom' },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses tampered, expired, foreign and legacy tickets without asking MMRAD', async () => {
    const deps = dependencies();
    const valid = ticketFor();
    const [payload, signature] = valid.split('.');
    const forged = Buffer.from(signature, 'base64url');
    forged[0] ^= 0x01;
    await withFunction(deps, async endpoint => {
      for (const ticket of [
        `${payload}.${forged.toString('base64url')}`,
        ticketFor({ subject: 'other-user' }),
        ticketFor({ viewer: undefined, session: undefined }),
        'not-a-ticket',
      ]) {
        const response = await post(endpoint, { ticket });
        expect(response.status).toBe(403);
        expect((await response.json()).code).toBeUndefined();
      }
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60_000);
      const expired = await post(endpoint, { ticket: valid });
      expect(expired.status).toBe(403);
      expect(await expired.json()).toMatchObject({ code: 'ticket-expired' });
      vi.mocked(Date.now).mockRestore();
      for (const body of [{}, [valid], { ticket: 7 }])
        expect((await post(endpoint, body)).status).toBe(400);
    });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('carries at most 30 MB per original, declared or streamed', async () => {
    const declared = dependencies({
      fetchImpl: vi.fn(
        async () => new Response(ORIGINAL, { headers: { 'Content-Length': '31000000' } })
      ),
    });
    await withFunction(declared, async endpoint => {
      const response = await post(endpoint, { ticket: ticketFor() });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ code: 'too-large', bytes: 31_000_000 });
    });
    const chunk = new Uint8Array(1_000_000);
    let sent = 0;
    const streamed = dependencies({
      fetchImpl: vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                sent += 1;
                if (sent > 40) controller.close();
                else controller.enqueue(chunk);
              },
            })
          )
      ),
    });
    await withFunction(streamed, async endpoint => {
      const response = await post(endpoint, { ticket: ticketFor() });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ code: 'too-large' });
    });
    // The upstream read stops right after the limit instead of draining it.
    expect(sent).toBeLessThanOrEqual(32);
  });

  it('refuses what is not a DICOM original and classifies MMRAD failures for retry', async () => {
    const answers: Array<[() => Promise<Response>, number, string | null]> = [
      [async () => new Response('<html>not dicom</html>'), 422, null],
      [
        async () => new Response('busy', { status: 503, headers: { 'Retry-After': '7' } }),
        503,
        '7',
      ],
      [async () => new Response('slow down', { status: 429 }), 429, null],
      [async () => new Response('missing', { status: 404 }), 422, null],
      [
        async () => {
          throw new TypeError('synthetic network failure');
        },
        502,
        null,
      ],
    ];
    for (const [answer, status, retryAfter] of answers) {
      await withFunction(dependencies({ fetchImpl: vi.fn(answer) }), async endpoint => {
        const response = await post(endpoint, { ticket: ticketFor() });
        expect(response.status).toBe(status);
        expect(response.headers.get('retry-after')).toBe(retryAfter);
        expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      });
    }
  });

  it('keeps its per-user quota and never echoes tickets, cookies or sessions', async () => {
    const logs = ['log', 'info', 'warn', 'error', 'debug'].map(method =>
      vi.spyOn(console, method as 'log')
    );
    const limited = dependencies({ isRateLimited: vi.fn(() => true) });
    await withFunction(limited, async endpoint => {
      const response = await post(endpoint, { ticket: ticketFor() });
      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBe('60');
    });
    expect(limited.isRateLimited).toHaveBeenCalledWith(SUBJECT);
    expect(limited.fetchImpl).not.toHaveBeenCalled();
    const failing = dependencies({
      fetchImpl: vi.fn(async () => {
        throw new Error(`synthetic failure for ${COOKIE} ${SESSION}`);
      }),
    });
    await withFunction(failing, async endpoint => {
      const ticket = ticketFor();
      for (const body of [{ ticket }, { ticket: `${ticket}x` }]) {
        const text = await (await post(endpoint, body)).text();
        for (const secret of [ticket, COOKIE, SESSION, SYNTHETIC_STUDY_UID, 'synthetic failure'])
          expect(text).not.toContain(secret);
      }
    });
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });
});
