// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../extension/urgency-session-page.js';

declare global {
  var HhrUrgencySessionPage: { isUsable: () => Promise<boolean> };
}

const harness = () => {
  const owner = { facilityId: 9, staffId: 6, logged: true };
  const validToken = vi.fn(async (_staffId: string, _facilityId: string) => true);
  const login = {
    getCurrentFacility: () => ({ Id: owner.facilityId }),
    getCurrentStaffMember: () => ({ Id: owner.staffId }),
    isStaffMemberLogged: () => owner.logged,
    validToken,
  };
  const get = vi.fn((service: string) => {
    if (service !== 'loginService') throw new Error('Unexpected synthetic clinical service');
    return login;
  });
  vi.stubGlobal('location', {
    origin: 'https://urgencia.saludenred.cl',
    pathname: '/Emergency/',
  });
  vi.stubGlobal('document', { body: {} });
  vi.stubGlobal('window', { angular: { element: () => ({ injector: () => ({ get }) }) } });
  return { owner, validToken, get };
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('read-only preflight in an existing native Urgencias page', () => {
  it('returns only a boolean after native token validation, without clinical services', async () => {
    const h = harness();
    expect(await HhrUrgencySessionPage.isUsable()).toBe(true);
    expect(h.validToken).toHaveBeenCalledWith('6', '9');
    expect(h.get).toHaveBeenCalledExactlyOnceWith('loginService');
  });
  it('recognizes a logged-out page without consulting the API', async () => {
    const h = harness();
    h.owner.logged = false;
    expect(await HhrUrgencySessionPage.isUsable()).toBe(false);
    expect(h.validToken).not.toHaveBeenCalled();
  });
  it('recognizes server-side expiration even when the page retains its staff and facility', async () => {
    const h = harness();
    h.validToken.mockResolvedValue(false);
    expect(await HhrUrgencySessionPage.isUsable()).toBe(false);
  });
  it('rejects an owner change during validation', async () => {
    const h = harness();
    h.validToken.mockImplementation(async () => {
      h.owner.staffId = 99;
      return true;
    });
    expect(await HhrUrgencySessionPage.isUsable()).toBe(false);
  });
  it('treats an unavailable validator as missing usable access', async () => {
    const h = harness();
    h.validToken.mockRejectedValue(new Error('Synthetic validation failure'));
    expect(await HhrUrgencySessionPage.isUsable()).toBe(false);
  });
  it('bounds a stalled validation so it cannot hold the login behind HCC', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.validToken.mockImplementation(() => new Promise<boolean>(() => {}));
    const result = HhrUrgencySessionPage.isUsable();
    await vi.advanceTimersByTimeAsync(2500);
    expect(await result).toBe(false);
  });
  it('does not inspect authentication on a PDF/blob or another origin', async () => {
    const h = harness();
    vi.stubGlobal('location', { origin: 'null', pathname: '/Emergency/' });
    expect(await HhrUrgencySessionPage.isUsable()).toBe(false);
    expect(h.get).not.toHaveBeenCalled();
  });
});
