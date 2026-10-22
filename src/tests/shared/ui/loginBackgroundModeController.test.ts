import { beforeEach, describe, expect, it } from 'vitest';
import {
  LOGIN_BACKGROUND_MODE_STORAGE_KEY,
  persistLoginBackgroundMode,
  resolveInitialLoginBackgroundMode,
  resolveLoginBackgroundImage,
  resolveTimeBasedLoginBackgroundMode,
} from '@/shared/ui/loginBackgroundModeController';

describe('shared loginBackgroundModeController', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('resolves the stored login background mode before falling back to time', () => {
    window.localStorage.setItem(LOGIN_BACKGROUND_MODE_STORAGE_KEY, 'night');

    expect(resolveInitialLoginBackgroundMode()).toBe('night');
  });

  it('persists the login background mode for startup shells', () => {
    persistLoginBackgroundMode('day');

    expect(window.localStorage.getItem(LOGIN_BACKGROUND_MODE_STORAGE_KEY)).toBe('day');
  });

  it('resolves day and night assets from the shared UI contract', () => {
    expect(resolveLoginBackgroundImage('day')).toBe('/images/login/hhr-login-day.webp');
    expect(resolveLoginBackgroundImage('night')).toBe('/images/login/hhr-login-night.webp');
  });

  it('uses day mode only during daytime hours', () => {
    expect(resolveTimeBasedLoginBackgroundMode(new Date('2026-04-24T12:00:00'))).toBe('day');
    expect(resolveTimeBasedLoginBackgroundMode(new Date('2026-04-24T23:00:00'))).toBe('night');
  });

  it('reads daytime on the hospital clock, not the device clock', () => {
    // 12:30Z on Apr 24 is 08:30 in Santiago but still 06:30 in Rapa Nui (UTC-6).
    expect(resolveTimeBasedLoginBackgroundMode(new Date('2026-04-24T12:30:00.000Z'))).toBe('night');
    // 14:00Z is 08:00 in Rapa Nui: the day background starts with the hospital morning.
    expect(resolveTimeBasedLoginBackgroundMode(new Date('2026-04-24T14:00:00.000Z'))).toBe('day');
  });
});
