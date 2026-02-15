import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntime';

export interface SharedCensusBrowserRuntime {
  alert: (message: string) => void;
  open: (url: string, target?: string) => void;
}

export const defaultSharedCensusBrowserRuntime: SharedCensusBrowserRuntime = {
  alert: message => {
    defaultBrowserWindowRuntime.alert(message);
  },
  open: (url, target = '_blank') => {
    defaultBrowserWindowRuntime.open(url, target);
  },
};
