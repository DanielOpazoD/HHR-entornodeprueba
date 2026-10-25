import { useEffect, useState, useSyncExternalStore } from 'react';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import {
  isFunctionsReloadRequired,
  subscribeFunctionsRecovery,
} from '@/services/firebase-runtime/functionsModuleLoader';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { AUTH_UI_COPY } from '@/services/auth/authUiCopy';

const warmFunctions = async () => {
  if (!navigator.onLine) return;
  await defaultFunctionsRuntime.ready;
  if (navigator.onLine) await defaultFunctionsRuntime.getFunctions();
};

export default function FunctionsRecoveryNotice() {
  const needsReload = useSyncExternalStore(subscribeFunctionsRecovery, isFunctionsReloadRequired);
  useEffect(() => {
    const warm = () => {
      void warmFunctions().catch(() => {});
    };
    warm();
    window.addEventListener('online', warm);
    return () => window.removeEventListener('online', warm);
  }, []);
  return (
    <aside
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="fixed inset-x-0 bottom-0 z-[100]"
    >
      {needsReload ? <FunctionsRecoveryBanner /> : null}
    </aside>
  );
}

function FunctionsRecoveryBanner() {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let active = true;
    const confirmConnection = async () => {
      if (!navigator.onLine) {
        if (active) setConnected(false);
        return;
      }
      try {
        const response = await fetch(`/version.json?functions-recovery=${Date.now()}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) {
          if (active) setConnected(false);
          return;
        }
        await warmFunctions().catch(() => {});
        if (active) setConnected(isFunctionsReloadRequired());
      } catch {
        if (active) setConnected(false);
      }
    };
    void confirmConnection();
    const timer = window.setInterval(() => {
      void confirmConnection();
    }, 5000);
    window.addEventListener('online', confirmConnection);
    const offline = () => setConnected(false);
    window.addEventListener('offline', offline);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('online', confirmConnection);
      window.removeEventListener('offline', offline);
    };
  }, []);
  if (!connected) return null;
  return (
    <div className="border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
      Se restableció la conexión. Recarga para reanudar el acceso y la sincronización; los cambios
      pendientes se conservan.{' '}
      <button
        type="button"
        className="underline"
        onClick={() => {
          if (defaultBrowserWindowRuntime.confirm(AUTH_UI_COPY.reloadApplicationConfirm)) {
            defaultBrowserWindowRuntime.reload();
          }
        }}
      >
        Recargar aplicación
      </button>
    </div>
  );
}
