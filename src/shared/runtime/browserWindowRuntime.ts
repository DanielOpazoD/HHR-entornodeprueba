export interface BrowserWindowRuntime {
  alert: (message: string) => void;
  confirm: (message: string) => boolean;
  open: (url: string, target?: string) => Window | null;
  reload: () => void;
  getLocationOrigin: () => string;
  getLocationPathname: () => string;
  getLocationHref: () => string;
  getViewportWidth: () => number;
  getLocalStorageItem: (key: string) => string | null;
  setLocalStorageItem: (key: string, value: string) => void;
  removeLocalStorageItem: (key: string) => void;
}

const hasWindow = (): boolean => typeof window !== 'undefined';

export const createBrowserWindowRuntime = (): BrowserWindowRuntime => ({
  alert: message => {
    if (!hasWindow()) {
      return;
    }

    window.alert(message);
  },
  confirm: message => {
    if (!hasWindow()) {
      return false;
    }

    return window.confirm(message);
  },
  open: (url, target = '_blank') => {
    if (!hasWindow()) {
      return null;
    }

    return window.open(url, target);
  },
  reload: () => {
    if (!hasWindow()) {
      return;
    }

    window.location.reload();
  },
  getLocationOrigin: () => {
    if (!hasWindow()) {
      return '';
    }

    return window.location.origin;
  },
  getLocationPathname: () => {
    if (!hasWindow()) {
      return '';
    }

    return window.location.pathname;
  },
  getLocationHref: () => {
    if (!hasWindow()) {
      return '';
    }

    return window.location.href;
  },
  getViewportWidth: () => {
    if (!hasWindow()) {
      return 0;
    }

    return window.innerWidth;
  },
  getLocalStorageItem: key => {
    if (!hasWindow()) {
      return null;
    }

    return window.localStorage.getItem(key);
  },
  setLocalStorageItem: (key, value) => {
    if (!hasWindow()) {
      return;
    }

    window.localStorage.setItem(key, value);
  },
  removeLocalStorageItem: key => {
    if (!hasWindow()) {
      return;
    }

    window.localStorage.removeItem(key);
  },
});

export const writeClipboardText = async (text: string): Promise<void> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    throw new Error('Clipboard API no disponible');
  }

  await navigator.clipboard.writeText(text);
};

export const getNavigatorUserAgent = (): string =>
  typeof navigator !== 'undefined' ? navigator.userAgent : '';

export const defaultBrowserWindowRuntime = createBrowserWindowRuntime();
