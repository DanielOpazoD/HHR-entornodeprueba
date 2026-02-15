export interface BrowserWindowRuntime {
  alert: (message: string) => void;
  confirm: (message: string) => boolean;
  open: (url: string, target?: string) => void;
  reload: () => void;
  getLocationOrigin: () => string;
  getLocationPathname: () => string;
  getLocationHref: () => string;
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
      return;
    }

    window.open(url, target);
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

export const defaultBrowserWindowRuntime = createBrowserWindowRuntime();
