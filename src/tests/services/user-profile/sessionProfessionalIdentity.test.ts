import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureSessionProfessionalIdentity,
  clearPendingProfessionalIdentity,
  readSessionProfessionalIdentity,
} from '@/services/user-profile/sessionProfessionalIdentity';
import { beginPendingLogout } from '@/services/auth/authLogoutState';

const identity = { uid: 'synthetic-user', name: 'Profesional de prueba', rut: '11111111-1' };
const normalized = { ...identity, rut: '11.111.111-1' };
const key = `hhr_professional_identity_v1.${identity.uid}`;

describe('session professional prefilling identity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearPendingProfessionalIdentity();
    sessionStorage.clear();
  });

  it('keeps capture in memory until a post-admission read persists only the three hint fields', () => {
    const store = vi.spyOn(sessionStorage, 'setItem');
    captureSessionProfessionalIdentity(identity);
    expect(store).not.toHaveBeenCalled();
    expect(readSessionProfessionalIdentity(identity.uid)).toEqual(normalized);
    expect(JSON.parse(sessionStorage.getItem(key) ?? '{}')).toEqual(normalized);
    expect(store).toHaveBeenCalledTimes(1);
  });

  it('reloads the persisted same-UID hint and never returns it for another UID', async () => {
    captureSessionProfessionalIdentity(identity);
    readSessionProfessionalIdentity(identity.uid);
    vi.resetModules();
    const reloaded = await import('@/services/user-profile/sessionProfessionalIdentity');
    expect(reloaded.readSessionProfessionalIdentity(identity.uid)).toEqual(normalized);
    expect(reloaded.readSessionProfessionalIdentity('another-user')).toBeNull();
  });

  it('discards another UID pending hint and rejects a stored payload whose UID does not match its key', () => {
    captureSessionProfessionalIdentity(identity);
    expect(readSessionProfessionalIdentity('another-user')).toBeNull();
    expect(readSessionProfessionalIdentity(identity.uid)).toBeNull();
    sessionStorage.setItem(key, JSON.stringify({ ...normalized, uid: 'another-user' }));
    expect(readSessionProfessionalIdentity(identity.uid)).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it('keeps a valid same-UID hint through a password change without RUT or invalid capture', () => {
    captureSessionProfessionalIdentity(identity);
    captureSessionProfessionalIdentity({ ...identity, name: 'Must not replace', rut: undefined });
    captureSessionProfessionalIdentity({ ...identity, rut: '11.111.111-2' });
    expect(readSessionProfessionalIdentity(identity.uid)).toEqual(normalized);
  });

  it('drops the previous pending owner when another authenticated UID has no valid RUT', () => {
    captureSessionProfessionalIdentity(identity);
    captureSessionProfessionalIdentity({ uid: 'another-user', name: '', rut: undefined });
    expect(readSessionProfessionalIdentity(identity.uid)).toBeNull();
  });

  it('rejects corrupt, incomplete and extra-field stored payloads at the boundary', () => {
    for (const raw of [
      '{bad json',
      JSON.stringify({ ...normalized, rut: '11.111.111-2' }),
      JSON.stringify({ ...normalized, unexpected: 'not-allowed' }),
      JSON.stringify({ uid: identity.uid }),
    ]) {
      sessionStorage.setItem(key, raw);
      expect(readSessionProfessionalIdentity(identity.uid)).toBeNull();
    }
  });

  it('returns the pending hint when storage is denied and fails softly on later reads', () => {
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => captureSessionProfessionalIdentity(identity)).not.toThrow();
    expect(readSessionProfessionalIdentity(identity.uid)).toEqual(normalized);
    expect(readSessionProfessionalIdentity(identity.uid)).toBeNull();
  });

  it('clears an unconsumed hint through the existing logout lifecycle', () => {
    captureSessionProfessionalIdentity(identity);
    const finish = beginPendingLogout();
    finish();
    expect(readSessionProfessionalIdentity(identity.uid)).toBeNull();
  });
});
