import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect,
  useRef,
} from 'react';
import { CURRENT_SCHEMA_VERSION } from '@/constants/version';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { createScopedLogger } from '@/services/utils/loggerScope';
import {
  assessRemoteRuntimeContract,
  fetchRemoteRuntimeContract,
  type RemoteRuntimeContract,
} from '@/services/config/runtimeContractClient';

type VersionUpdateReason =
  | 'current'
  | 'new_build_available'
  | 'runtime_contract_mismatch'
  | 'schema_ahead_of_client';

const RUNTIME_CONTRACT_CHECK_INTERVAL_MS = 5 * 60 * 1000;

interface VersionContextType {
  isOutdated: boolean;
  appVersion: number;
  remoteVersion: number | null;
  updateReason: VersionUpdateReason;
  runtimeContract: RemoteRuntimeContract | null;
  checkVersion: (remoteVersion: number) => void;
  checkRuntimeContract: () => Promise<void>;
  forceUpdate: () => void;
}

const VersionContext = createContext<VersionContextType | undefined>(undefined);
const versionLogger = createScopedLogger('VersionContext');

export const VersionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isOutdated, setIsOutdated] = useState(false);
  const [remoteVersion, setRemoteVersion] = useState<number | null>(null);
  const [runtimeContract, setRuntimeContract] = useState<RemoteRuntimeContract | null>(null);
  const [updateReason, setUpdateReason] = useState<VersionUpdateReason>('current');
  const mounted = useRef(true);
  const schemaAhead = useRef(false);
  const checkInFlight = useRef<Promise<void> | null>(null);

  const checkVersion = useCallback((remoteVersionValue: number) => {
    if (remoteVersionValue > CURRENT_SCHEMA_VERSION) {
      versionLogger.error('App version mismatch detected', {
        localVersion: CURRENT_SCHEMA_VERSION,
        remoteVersion: remoteVersionValue,
      });
      schemaAhead.current = true;
      setIsOutdated(true);
      setRemoteVersion(previous => Math.max(previous ?? 0, remoteVersionValue));
      setUpdateReason('schema_ahead_of_client');
    }
  }, []);

  const checkRuntimeContract = useCallback((): Promise<void> => {
    if (!mounted.current) return Promise.resolve();
    if (checkInFlight.current) return checkInFlight.current;

    return (checkInFlight.current = Promise.resolve()
      .then(async () => {
        if (!mounted.current) return;
        try {
          const contract = await fetchRemoteRuntimeContract();
          if (!mounted.current || !contract) return;

          setRuntimeContract(contract);
          const assessment = assessRemoteRuntimeContract(contract);
          if (!assessment.ok) {
            setIsOutdated(true);
            setUpdateReason(
              assessment.disposition === 'runtime_contract_mismatch'
                ? 'runtime_contract_mismatch'
                : 'schema_ahead_of_client'
            );
            if (assessment.disposition === 'schema_ahead_of_client') {
              schemaAhead.current = true;
              setRemoteVersion(previous =>
                Math.max(previous ?? 0, contract.supportedSchemaVersion)
              );
            }
            versionLogger.error('Runtime contract mismatch detected', {
              localVersion: CURRENT_SCHEMA_VERSION,
              contract,
              disposition: assessment.disposition,
            });
            return;
          }

          setIsOutdated(schemaAhead.current);
          setUpdateReason(schemaAhead.current ? 'schema_ahead_of_client' : 'current');
        } catch (error) {
          if (mounted.current) versionLogger.warn('Runtime contract check failed', error);
        }
      })
      .finally(() => {
        checkInFlight.current = null;
      }));
  }, []);

  const forceUpdate = useCallback(() => {
    defaultBrowserWindowRuntime.reload();
  }, []);

  useEffect(() => {
    mounted.current = true;
    void checkRuntimeContract();
    const interval = window.setInterval(checkRuntimeContract, RUNTIME_CONTRACT_CHECK_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkRuntimeContract();
      }
    };

    window.addEventListener('focus', checkRuntimeContract);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mounted.current = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', checkRuntimeContract);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkRuntimeContract]);

  return (
    <VersionContext.Provider
      value={{
        isOutdated,
        appVersion: CURRENT_SCHEMA_VERSION,
        remoteVersion,
        updateReason,
        runtimeContract,
        checkVersion,
        checkRuntimeContract,
        forceUpdate,
      }}
    >
      {children}
    </VersionContext.Provider>
  );
};

export const useVersion = () => {
  const context = useContext(VersionContext);
  if (!context) {
    throw new Error('useVersion must be used within a VersionProvider');
  }
  return context;
};
