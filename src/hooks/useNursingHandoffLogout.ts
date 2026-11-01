import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthUser } from '@/types/authRoleTypes';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';

type Choice = 'retry' | 'download' | 'cancel' | 'automatic';
export interface NursingLogoutPrompt {
  choose: (choice: Choice) => void;
  error?: string;
}

export const useRetainedNursingHandoffOwners = (uid: string): string[] => {
  const [owners, setOwners] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void import('@/services/storage/sync/nursingHandoffSession')
      .then(service => service.resumeOwnedNursingHandoff(`user:${uid}`))
      .then(labels => {
        if (active) setOwners(labels);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [uid]);
  return owners;
};

export const useNursingHandoffLogout = (
  user: AuthUser | null,
  logout: (reason?: 'manual' | 'automatic') => Promise<void>
) => {
  const [logoutPrompt, setPrompt] = useState<NursingLogoutPrompt | null>(null);
  const choice = useRef<((value: Choice) => void) | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const automatic = useRef(false);
  useEffect(
    () => () => {
      choice.current?.('cancel');
    },
    [user?.uid]
  );

  const handleLogout = useCallback(
    (reason: 'manual' | 'automatic' = 'manual'): Promise<void> => {
      if (inFlight.current) {
        if (reason === 'automatic') {
          automatic.current = true;
          choice.current?.('automatic');
        }
        return inFlight.current;
      }
      if (!user) return logout(reason);
      if (!getStoredSessionOwnerKey()) return logout(reason);
      automatic.current = reason === 'automatic';
      const owner = `user:${user.uid}`;
      const generation = getSessionGeneration();
      const isCurrent = () =>
        owner === getStoredSessionOwnerKey() && generation === getSessionGeneration();
      const run = async () => {
        const load = () => import('@/services/storage/sync/nursingHandoffSession');
        const attempt = async () => {
          const abort = new AbortController();
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              load()
                .then(service =>
                  abort.signal.aborted
                    ? false
                    : service.attemptNursingHandoffLogout(
                        owner,
                        user.displayName || user.email || 'Enfermería',
                        abort.signal
                      )
                )
                .catch(() => false),
              new Promise<boolean>(resolve => {
                timer = setTimeout(() => {
                  abort.abort();
                  resolve(false);
                }, 10_000);
              }),
            ]);
          } finally {
            clearTimeout(timer);
            abort.abort();
          }
        };
        while (isCurrent()) {
          const confirmed = await attempt();
          if (!isCurrent()) return;
          if (confirmed || automatic.current) {
            setPrompt(null);
            await logout(automatic.current ? 'automatic' : 'manual');
            return;
          }
          let error: string | undefined;
          while (isCurrent()) {
            const selected = await new Promise<Choice>(resolve => {
              choice.current = resolve;
              setPrompt({ choose: resolve, error });
            });
            choice.current = null;
            setPrompt(null);
            if (!isCurrent() || selected === 'cancel') return;
            if (selected === 'retry') break;
            if (selected === 'automatic') {
              await logout('automatic');
              return;
            }
            try {
              await (await load()).downloadPendingNursingHandoff(owner);
              if (isCurrent()) await logout('manual');
              return;
            } catch {
              error = 'No se pudo descargar la copia. La sesión y la entrega siguen aquí.';
            }
          }
        }
      };
      inFlight.current = run().finally(() => {
        inFlight.current = null;
        choice.current = null;
        setPrompt(null);
      });
      return inFlight.current;
    },
    [user, logout]
  );
  return { handleLogout, logoutPrompt };
};
