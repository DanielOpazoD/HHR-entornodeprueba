import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginToMMRAD } from '../../../netlify/functions/lib/mmrad-session';

const loginAction = 'https://ris.mmrad.cl/c/portal/login%2Flogin';
const searchAction = 'https://ris.mmrad.cl/examenportlet/search';
const dashboard = `<form action="${searchAction}"><input name="idpaciente" /></form>`;
const loginPage = `<form action="${loginAction}"><input name="_58_login" /></form>`;

describe('MMRAD login redirect chain', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubEnv('MMRAD_USERNAME', 'synthetic-user');
    vi.stubEnv('MMRAD_PASSWORD', 'synthetic-password');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response(loginPage));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([0, 1, 2, 3, 5])(
    'finds the search form after %i redirects and keeps rotated cookies',
    async count => {
      for (let hop = 0; hop < count; hop += 1) {
        fetchMock.mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: { location: `/redirect-${hop}`, 'set-cookie': `SESSION=hop-${hop}; Path=/` },
          })
        );
      }
      fetchMock.mockResolvedValueOnce(
        new Response(dashboard, {
          headers: { 'set-cookie': 'SESSION=final; Path=/' },
        })
      );
      const result = await loginToMMRAD();
      expect(result.searchActionUrl).toBe(searchAction);
      expect(result.cookies).toBe('SESSION=final');
      expect(fetchMock).toHaveBeenCalledTimes(count + 2);
      for (let hop = 0; hop < count; hop += 1) {
        expect(fetchMock.mock.calls[hop + 2]?.[1]?.headers).toEqual(
          expect.objectContaining({ Cookie: `SESSION=hop-${hop}` })
        );
      }
    }
  );

  it('preserves POST for 307 and switches to GET for 303', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 307, headers: { location: '/preserve' } })
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 303, headers: { location: '/dashboard' } })
      )
      .mockResolvedValueOnce(new Response(dashboard));
    await loginToMMRAD();
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(fetchMock.mock.calls[1]?.[1]?.body);
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe('GET');
    expect(fetchMock.mock.calls[3]?.[1]?.body).toBeUndefined();
  });

  it('rejects a return to the login form', async () => {
    fetchMock.mockResolvedValueOnce(new Response(loginPage));
    await expect(loginToMMRAD()).rejects.toThrow(/sesión/i);
  });

  it('rejects an external login redirect before forwarding credentials', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 307,
        headers: { location: 'https://example.invalid/login' },
      })
    );
    await expect(loginToMMRAD()).rejects.toThrow(/permitido/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
