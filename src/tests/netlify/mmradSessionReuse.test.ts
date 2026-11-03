import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forgetMMRADSession,
  isLoggedInRisPage,
  withMMRADSession,
  type LoginResult,
} from '../../../netlify/functions/lib/mmrad-session';

const session = (name: string): LoginResult => ({
  cookies: `JSESSIONID=${name}`,
  searchActionUrl: 'https://ris.mmrad.cl/search',
});

describe('reusing the RIS session of a warm function', () => {
  beforeEach(() => forgetMMRADSession());
  afterEach(() => vi.useRealTimers());

  it('tells a logged-in results page from the login page', () => {
    expect(isLoggedInRisPage('<form><input name="_2_idpaciente" /></form><table></table>')).toBe(
      true
    );
    expect(isLoggedInRisPage('<form><input name="_58_login" /></form>')).toBe(false);
    expect(isLoggedInRisPage('<html><body>Bienvenido</body></html>')).toBe(false);
  });

  it('logs in once for consecutive requests and again after ten minutes', async () => {
    vi.useFakeTimers();
    const login = vi.fn(async () => session(`s${login.mock.calls.length}`));
    const work = vi.fn(async (current: LoginResult) => current.cookies);

    expect(await withMMRADSession(work, undefined, login)).toBe('JSESSIONID=s1');
    expect(await withMMRADSession(work, undefined, login)).toBe('JSESSIONID=s1');
    expect(login).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10 * 60_000);
    expect(await withMMRADSession(work, undefined, login)).toBe('JSESSIONID=s2');
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('repeats work that failed on a reused session once, after a fresh login', async () => {
    const login = vi.fn(async () => session(`s${login.mock.calls.length}`));
    await withMMRADSession(async () => 'warm', undefined, login);
    const work = vi.fn(async (current: LoginResult) => {
      if (current.cookies === 'JSESSIONID=s1') throw new Error('La sesión MMRAD no está activa.');
      return current.cookies;
    });

    expect(await withMMRADSession(work, undefined, login)).toBe('JSESSIONID=s2');
    expect(work).toHaveBeenCalledTimes(2);
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('does not keep a session whose work failed, nor retry a fresh failure or a cancellation', async () => {
    const login = vi.fn(async () => session(`s${login.mock.calls.length}`));
    const failing = vi.fn(async () => {
      throw new Error('synthetic failure');
    });
    await expect(withMMRADSession(failing, undefined, login)).rejects.toThrow('synthetic');
    expect(failing).toHaveBeenCalledTimes(1);
    await withMMRADSession(async () => 'ok', undefined, login);
    expect(login).toHaveBeenCalledTimes(2);

    const controller = new AbortController();
    controller.abort();
    await expect(withMMRADSession(failing, controller.signal, login)).rejects.toThrow('synthetic');
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('keeps no session when the login found no search form', async () => {
    const login = vi.fn(async () => ({ cookies: '', searchActionUrl: null }));
    await withMMRADSession(async () => 'empty', undefined, login);
    await withMMRADSession(async () => 'empty', undefined, login);
    expect(login).toHaveBeenCalledTimes(2);
  });
});
