import { describe, expect, it, vi } from 'vitest';
import {
  withFunctionHandler,
  type FunctionContext,
  type FunctionResponse,
  type FunctionStep,
} from '../../../netlify/functions/lib/function-handler';
import type { NetlifyEventLike } from '../../../netlify/functions/lib/http';

const event = (httpMethod = 'GET', headers = {}): NetlifyEventLike => ({ httpMethod, headers });
const wire: FunctionResponse = {
  statusCode: 207,
  headers: { 'X-Synthetic': 'unchanged' },
  body: 'AAEC',
  isBase64Encoded: true,
};
const setup = () => {
  const context = vi.fn((ctx: FunctionContext) => ({ ...ctx, marker: 'per-request' }));
  const allowed = vi.fn(
    (origin: string | undefined) => !origin || origin === 'https://synthetic.example'
  );
  const denied = vi.fn(() => ({ statusCode: 403, headers: {}, body: 'denied' }));
  const preflight = vi.fn(() => wire);
  const prepare = vi.fn((ctx: FunctionContext): FunctionStep<string> => {
    const gate = ctx.method(['GET'], () => ({ statusCode: 405, headers: {}, body: 'method' }));
    return gate.kind === 'reply' ? gate : { kind: 'continue', value: 'prepared' };
  });
  const run = vi.fn(() => wire);
  const handler = withFunctionHandler({
    context,
    origin: { isOriginAllowed: allowed, denied },
    preflight,
    prepare,
    run,
  });
  return { handler, context, allowed, denied, preflight, prepare, run };
};

describe('withFunctionHandler HTTP boundary', () => {
  it('reads Origin case-insensitively, rejects before preflight/prepare/run', async () => {
    const s = setup();
    expect(await s.handler(event('OPTIONS', { OrIgIn: 'https://hostile.example' }))).toEqual({
      statusCode: 403,
      headers: {},
      body: 'denied',
    });
    expect(s.allowed).toHaveBeenCalledWith('https://hostile.example');
    expect(s.preflight).not.toHaveBeenCalled();
    expect(s.prepare).not.toHaveBeenCalled();
    expect(s.run).not.toHaveBeenCalled();
  });
  it.each([undefined, 'https://synthetic.example'])(
    'allowed OPTIONS bypasses preparation: %s',
    async origin => {
      const s = setup();
      expect(await s.handler(event('OPTIONS', { origin }))).toBe(wire);
      expect(s.preflight).toHaveBeenCalledOnce();
      expect(s.prepare).not.toHaveBeenCalled();
      expect(s.run).not.toHaveBeenCalled();
    }
  );
  it('origin policy explicitly decides whether absent Origin is allowed', async () => {
    const s = setup();
    s.allowed.mockReturnValue(false);
    expect(await s.handler(event())).toEqual({ statusCode: 403, headers: {}, body: 'denied' });
    expect(s.allowed).toHaveBeenCalledWith(undefined);
    expect(s.prepare).not.toHaveBeenCalled();
  });
  it('passes typed prepared value and request context, preserving response identity', async () => {
    const s = setup();
    const request = event('GET', { origin: 'https://synthetic.example' });
    expect(await s.handler(request)).toBe(wire);
    expect(s.run).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        event: request,
        requestOrigin: 'https://synthetic.example',
        marker: 'per-request',
      }),
      'prepared'
    );
  });
  it('preparation reply preserves exact response and skips run', async () => {
    const s = setup();
    expect(await s.handler(event('POST'))).toEqual({
      statusCode: 405,
      headers: {},
      body: 'method',
    });
    expect(s.run).not.toHaveBeenCalled();
  });
  it('method gate is explicit: run can forward an unadvertised method', async () => {
    const s = setup();
    s.prepare.mockReturnValue({ kind: 'continue', value: 'opaque' });
    expect(await s.handler(event('PATCH'))).toBe(wire);
  });
  it('does not add, merge or serialize a preflight response', async () => {
    const s = setup();
    const response = { statusCode: 204, headers: { 'Content-Length': '0' }, body: '' };
    s.preflight.mockReturnValue(response);
    expect(await s.handler(event('OPTIONS'))).toBe(response);
  });
  it('constructs context separately for every invocation', async () => {
    const s = setup();
    await s.handler(event());
    await s.handler(event());
    expect(s.run.mock.calls).toHaveLength(2);
    expect(s.context.mock.results[0]?.value).not.toBe(s.context.mock.results[1]?.value);
  });
  it.each(['context', 'allowed', 'denied', 'preflight', 'prepare', 'run'] as const)(
    'propagates %s exceptions without catch/retry',
    async phase => {
      const s = setup();
      const error = new Error('synthetic exception');
      if (phase === 'denied') s.allowed.mockReturnValue(false);
      s[phase].mockImplementation(() => {
        throw error;
      });
      await expect(s.handler(event(phase === 'preflight' ? 'OPTIONS' : 'GET'))).rejects.toBe(error);
      expect(s[phase]).toHaveBeenCalledOnce();
    }
  );
});
