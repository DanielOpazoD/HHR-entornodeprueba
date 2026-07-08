export type LoginBackgroundMode = 'day' | 'night';

export const LOGIN_BACKGROUND_MODE_STORAGE_KEY = 'hhr_login_background_mode';

const isLoginBackgroundMode = (value: unknown): value is LoginBackgroundMode =>
  value === 'day' || value === 'night';

const readStoredLoginBackgroundMode = (): LoginBackgroundMode | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const storedMode = window.localStorage.getItem(LOGIN_BACKGROUND_MODE_STORAGE_KEY);
    return isLoginBackgroundMode(storedMode) ? storedMode : null;
  } catch {
    return null;
  }
};

export const persistLoginBackgroundMode = (mode: LoginBackgroundMode): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(LOGIN_BACKGROUND_MODE_STORAGE_KEY, mode);
  } catch {
    // The background toggle is decorative; storage failures should not block login.
  }
};

export const resolveTimeBasedLoginBackgroundMode = (date = new Date()): LoginBackgroundMode => {
  const currentHour = date.getHours();
  return currentHour >= 8 && currentHour < 20 ? 'day' : 'night';
};

export const resolveInitialLoginBackgroundMode = (): LoginBackgroundMode =>
  readStoredLoginBackgroundMode() ?? resolveTimeBasedLoginBackgroundMode();

export const resolveLoginBackgroundImage = (mode: LoginBackgroundMode): string =>
  mode === 'day' ? '/images/login/hhr-login-day.webp' : '/images/login/hhr-login-night.webp';
