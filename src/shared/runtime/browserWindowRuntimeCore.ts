export interface BrowserWindowRuntime {
  alert: (message: string) => void;
  confirm: (message: string) => boolean;
  open: (url: string, target?: string, features?: string) => Window | null;
  reload: () => void;
  getLocationOrigin: () => string;
  getLocationPathname: () => string;
  getLocationHref: () => string;
  getViewportWidth: () => number;
  getLocalStorageItem: (key: string) => string | null;
  setLocalStorageItem: (key: string, value: string) => void;
  removeLocalStorageItem: (key: string) => void;
}

export interface BrowserWindowRuntimeDependencies {
  getWindow?: () => Window | null;
}

const getGlobalWindow = (): Window | null =>
  typeof window !== 'undefined' ? (window as Window) : null;

const readWindowValue = <T>(
  dependencies: BrowserWindowRuntimeDependencies,
  fallback: T,
  resolver: (runtimeWindow: Window) => T
): T => {
  const runtimeWindow = dependencies.getWindow ? dependencies.getWindow() : getGlobalWindow();
  if (!runtimeWindow) {
    return fallback;
  }

  return resolver(runtimeWindow);
};

const runWithWindow = (
  dependencies: BrowserWindowRuntimeDependencies,
  effect: (runtimeWindow: Window) => void
): void => {
  const runtimeWindow = dependencies.getWindow ? dependencies.getWindow() : getGlobalWindow();
  if (!runtimeWindow) {
    return;
  }

  effect(runtimeWindow);
};

export const createBrowserWindowRuntime = (
  dependencies: BrowserWindowRuntimeDependencies = {}
): BrowserWindowRuntime => ({
  alert: message => {
    runWithWindow(dependencies, runtimeWindow => {
      runtimeWindow.alert(message);
    });
  },
  confirm: message =>
    readWindowValue(dependencies, false, runtimeWindow => runtimeWindow.confirm(message)),
  open: (url, target = '_blank', features) =>
    readWindowValue(dependencies, null, runtimeWindow =>
      features === undefined
        ? runtimeWindow.open(url, target)
        : runtimeWindow.open(url, target, features)
    ),
  reload: () => {
    runWithWindow(dependencies, runtimeWindow => {
      runtimeWindow.location.reload();
    });
  },
  getLocationOrigin: () =>
    readWindowValue(dependencies, '', runtimeWindow => runtimeWindow.location.origin),
  getLocationPathname: () =>
    readWindowValue(dependencies, '', runtimeWindow => runtimeWindow.location.pathname),
  getLocationHref: () =>
    readWindowValue(dependencies, '', runtimeWindow => runtimeWindow.location.href),
  getViewportWidth: () =>
    readWindowValue(dependencies, 0, runtimeWindow => runtimeWindow.innerWidth),
  getLocalStorageItem: key =>
    readWindowValue(dependencies, null, runtimeWindow => runtimeWindow.localStorage.getItem(key)),
  setLocalStorageItem: (key, value) => {
    runWithWindow(dependencies, runtimeWindow => {
      runtimeWindow.localStorage.setItem(key, value);
    });
  },
  removeLocalStorageItem: key => {
    runWithWindow(dependencies, runtimeWindow => {
      runtimeWindow.localStorage.removeItem(key);
    });
  },
});

export const defaultBrowserWindowRuntime = createBrowserWindowRuntime();
