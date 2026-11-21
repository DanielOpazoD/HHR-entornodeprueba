import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Database, RefreshCw } from 'lucide-react';
import {
  getStorageFallbackNotice,
  getStorageFallbackUiDelayMs,
  getStorageFallbackUiCopy,
  markStorageAutoRecoveryAttempted,
  markStoragePersistentFallbackObserved,
  shouldAttemptStorageAutoRecovery,
  shouldShowStorageFallbackUi,
} from '@/services/storage/storageFallbackUiPolicy';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { useDatabaseFallbackStatus } from '@/hooks/useDatabaseFallbackStatus';
import { useLocalDatabaseReset } from '@/hooks/useLocalDatabaseReset';

/**
 * StorageStatusBadge
 *
 * Persistent warning shown only when IndexedDB fails and the system
 * is operating in degraded fallback mode.
 */
const StorageStatusBadge: React.FC = () => {
  const isFallback = useDatabaseFallbackStatus();
  const handleResetLocalDatabase = useLocalDatabaseReset();
  const [isVisible, setIsVisible] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const shouldShowBanner = shouldShowStorageFallbackUi(isFallback);
  const copy = getStorageFallbackUiCopy();
  const notice = getStorageFallbackNotice();

  useEffect(() => {
    if (!isFallback) return;

    if (typeof window === 'undefined') {
      return;
    }

    if (shouldAttemptStorageAutoRecovery(isFallback)) {
      markStorageAutoRecoveryAttempted();
      defaultBrowserWindowRuntime.reload();
      return;
    }

    if (!shouldShowBanner) {
      markStoragePersistentFallbackObserved();
    }
  }, [isFallback, shouldShowBanner]);

  if (!isFallback || !isVisible || !shouldShowBanner) return null;

  return (
    <DelayedStorageStatusBadge>
      <div className="fixed bottom-4 left-4 z-[9999] storage-status-badge-bounce">
        <div className="bg-amber-50 border border-amber-200 shadow-lg rounded-xl p-3 max-w-sm flex items-start gap-3">
          <div className="bg-amber-100 p-2 rounded-full shrink-0">
            <AlertTriangle className="text-amber-600 w-5 h-5" />
          </div>
          <div className="flex-1">
            <h4 className="text-amber-900 font-bold text-sm flex items-center gap-2">
              {notice.title}
            </h4>
            <p className="text-amber-800 text-xs mt-1 leading-relaxed">{notice.message}</p>
            {showDetails ? (
              <div className="mt-2 rounded-lg bg-amber-100/70 px-3 py-2 text-[11px] text-amber-900 leading-relaxed">
                {copy.detail}
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={defaultBrowserWindowRuntime.reload}
                className="text-[11px] bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-md flex items-center gap-1 transition-colors"
              >
                <RefreshCw className="w-3 h-3" /> {copy.primaryActionLabel}
              </button>
              <button
                onClick={() => setShowDetails(current => !current)}
                className="text-[11px] text-amber-700 hover:text-amber-900 px-1 py-1.5 font-medium flex items-center gap-1"
              >
                {showDetails ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
                {showDetails ? 'Ocultar detalle' : 'Más información'}
              </button>
              {showDetails ? (
                <button
                  onClick={() => void handleResetLocalDatabase()}
                  className="text-[11px] bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 px-3 py-1.5 rounded-md flex items-center gap-1 transition-colors"
                >
                  <Database className="w-3 h-3" /> {copy.advancedActionLabel}
                </button>
              ) : null}
              <button
                onClick={() => setIsVisible(false)}
                className="text-[11px] text-amber-500 hover:text-amber-700 font-medium ml-auto"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      </div>
    </DelayedStorageStatusBadge>
  );
};

const DelayedStorageStatusBadge: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsReady(true);
    }, getStorageFallbackUiDelayMs());

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  return isReady ? <>{children}</> : null;
};

export default StorageStatusBadge;
