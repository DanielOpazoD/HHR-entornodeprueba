import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyslabProxyHarness } from './support/syslabProxyHarness';

const actions = [
  { action: 'search', query: '&rut=11111111-1', body: null },
  { action: 'details', query: '', body: JSON.stringify({ links: ['https://lab.example.com/1'] }) },
  { action: 'pdf', query: '&link=https%3A%2F%2Flab.example.com%2F1', body: null },
];

describe('Syslab upstream telemetry', () => {
  const { fetchMock, loadHandler } = createSyslabProxyHarness();
  afterEach(() => vi.restoreAllMocks());

  const invoke = async (action: string, query: string, body: string | null) => {
    const handler = await loadHandler();
    return handler({
      httpMethod: action === 'details' ? 'POST' : 'GET',
      headers: { authorization: 'Bearer synthetic-token' },
      rawQuery: `action=${action}${query}`,
      body,
    });
  };

  it.each(actions)('records upstream 500 as failure for $action without retrying', async row => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const upstreamBody = { error: 'synthetic-private-upstream-body' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(upstreamBody), { status: 500 }));

    const response = await invoke(row.action, row.query, row.body);

    expect(response.statusCode).toBe(502);
    expect(response.body).toBe(
      row.action === 'pdf'
        ? 'Error al obtener el PDF del servidor de laboratorio'
        : JSON.stringify(upstreamBody)
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const entries = [
      ...vi.mocked(process.stdout.write).mock.calls.map(call => JSON.parse(String(call[0]))),
      ...errors.mock.calls.map(call => JSON.parse(String(call[0]))),
    ];
    expect(entries.map(entry => entry.status)).toEqual(['failure']);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(errors.mock.calls[0]?.[0]))).toMatchObject({
      level: 'error',
      kind: 'function_invocation',
      service: 'syslab',
      operation: row.action,
      status: 'failure',
      attempt: 1,
      totalAttempts: 1,
      willRetry: false,
      errorCode: expect.any(String),
      errorMessage: expect.any(String),
      durationMs: expect.any(Number),
      context: { action: row.action },
    });
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(
      /synthetic-private-upstream-body|synthetic-token|gateway-token|lab\.example\.com/
    );
    expect(process.stdout.write).not.toHaveBeenCalled();
  });

  it.each(actions)('keeps upstream 200 successful for $action', async row => {
    fetchMock.mockResolvedValue(
      new Response(row.action === 'pdf' ? '%PDF-1.4 synthetic' : '{"exams":[]}', { status: 200 })
    );
    const response = await invoke(row.action, row.query, row.body);
    expect(response.statusCode).toBe(200);
    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('"status":"success"')
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(actions)('keeps invalid caller input outside service failures for $action', async row => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await invoke(row.action, '', null);
    expect(response.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('"status":"success"')
    );
  });

  it.each([
    { error: new TypeError('synthetic network failure'), statusCode: 502, status: 'failure' },
    {
      error: Object.assign(new Error('synthetic timeout'), { name: 'TimeoutError' }),
      statusCode: 504,
      status: 'failure',
    },
  ])('preserves exception behavior ($statusCode) and its single attempt', async row => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue(row.error);
    const response = await invoke('search', '&rut=11111111-1', null);
    expect(response.statusCode).toBe(row.statusCode);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(errors.mock.calls[0]?.[0]))).toMatchObject({
      status: row.status,
      errorMessage: row.error.message,
      willRetry: false,
      attempt: 1,
      totalAttempts: 1,
    });
  });
});
