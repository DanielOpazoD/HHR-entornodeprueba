import { describe, expect, it } from 'vitest';
import { createSyslabProxyHarness } from './support/syslabProxyHarness';

describe('Syslab queue gateway', () => {
  const { fetchMock, authorizeRoleRequestMock, loadHandler } = createSyslabProxyHarness();
  it('binds queue access to the verified actor and ignores an owner supplied by the browser', async () => {
    authorizeRoleRequestMock.mockResolvedValue({
      email: 'synthetic@hospital.test',
      role: 'viewer',
      token: { sub: 'synthetic-operator', aud: 'demo-hhr-e2e' },
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, job: { id: 'synthetic-job' } }), { status: 202 })
    );
    const handler = await loadHandler();
    const response = await handler({
      httpMethod: 'POST',
      headers: {
        authorization: 'Bearer synthetic',
        'x-forwarded-for': '192.0.2.45',
        'x-hhr-lab-owner': 'spoofed',
      },
      body: JSON.stringify({ kind: 'census', patients: [] }),
      rawQuery: 'action=job-create',
    });
    expect(response.statusCode).toBe(202);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.headers).toMatchObject({
      'X-HHR-Lab-Owner': expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(request.headers)).not.toContain('spoofed');
    expect(JSON.stringify(request.headers)).not.toContain('synthetic-operator');
  });

  it('requires a verified UID for queue access and rejects mutation by GET', async () => {
    const handler = await loadHandler();
    const noUid = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer synthetic', 'x-forwarded-for': '192.0.2.46' },
      body: '{}',
      rawQuery: 'action=census-state',
    });
    expect(noUid.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    authorizeRoleRequestMock.mockResolvedValue({
      email: 'synthetic@hospital.test',
      role: 'admin',
      token: { sub: 'synthetic', aud: 'demo-hhr-e2e' },
    });
    const badMethod = await handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer synthetic', 'x-forwarded-for': '192.0.2.47' },
      rawQuery: 'action=job-create',
    });
    expect(badMethod.statusCode).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards result pages through the authenticated gateway with no cross-user URL path', async () => {
    authorizeRoleRequestMock.mockResolvedValue({
      email: 'synthetic@hospital.test',
      role: 'admin',
      token: { sub: 'synthetic', aud: 'demo-hhr-e2e' },
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [], nextOffset: null }))
    );
    const handler = await loadHandler();
    const response = await handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer synthetic' },
      rawQuery: 'action=job-result&id=123e4567-e89b-12d3-a456-426614174000&offset=50',
    });
    expect(response.statusCode).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://lab.example.com/api/jobs/123e4567-e89b-12d3-a456-426614174000/result?offset=50'
    );
  });
});
