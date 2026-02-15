import {
  defaultBrowserWindowRuntime,
  type BrowserWindowRuntime,
} from '@/shared/runtime/browserWindowRuntime';

export interface CensusDialogRuntime {
  alert: (message: string) => void;
  confirm: (message: string) => boolean;
  open: (url: string, target?: string) => void;
}

export interface CensusStorageRuntime {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export const createCensusDialogRuntime = (
  runtime: BrowserWindowRuntime = defaultBrowserWindowRuntime
): CensusDialogRuntime => ({
  alert: message => {
    runtime.alert(message);
  },
  confirm: message => runtime.confirm(message),
  open: (url, target = '_blank') => {
    runtime.open(url, target);
  },
});

export const createCensusStorageRuntime = (
  runtime: BrowserWindowRuntime = defaultBrowserWindowRuntime
): CensusStorageRuntime => ({
  getItem: key => runtime.getLocalStorageItem(key),
  setItem: (key, value) => {
    runtime.setLocalStorageItem(key, value);
  },
  removeItem: key => {
    runtime.removeLocalStorageItem(key);
  },
});
