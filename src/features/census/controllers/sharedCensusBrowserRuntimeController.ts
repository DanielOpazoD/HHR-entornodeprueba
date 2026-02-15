export interface SharedCensusBrowserRuntime {
  alert: (message: string) => void;
  open: (url: string, target?: string) => void;
}

export const defaultSharedCensusBrowserRuntime: SharedCensusBrowserRuntime = {
  alert: message => {
    if (typeof window === 'undefined') {
      return;
    }

    window.alert(message);
  },
  open: (url, target = '_blank') => {
    if (typeof window === 'undefined') {
      return;
    }

    window.open(url, target);
  },
};
