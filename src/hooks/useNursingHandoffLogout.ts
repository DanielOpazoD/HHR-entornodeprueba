import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthUser } from '@/types/authRoleTypes';
import { getTabOwnerKey, guardAuthoringSession } from '@/services/session/authoringSession';
import { isSessionCleanupPending } from '@/services/session/sessionOwnerKey';

type Choice = 'retry' | 'leave' | 'cancel' | 'automatic';
export interface NursingLogoutPrompt {
  choose: (choice: Choice) => void;
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
      const owner = `user:${user.uid}`;
      const session = guardAuthoringSession();
      if (!session.session.ownerKey) return logout(reason);
      if (isSessionCleanupPending()) {
        return getTabOwnerKey() === owner ? logout(reason) : Promise.resolve();
      }
      automatic.current = reason === 'automatic';
      const isCurrent = () => session.session.ownerKey === owner && session.isCurrent();
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
          const selected = await new Promise<Choice>(resolve => {
            choice.current = resolve;
            setPrompt({ choose: resolve });
          });
          choice.current = null;
          setPrompt(null);
          if (!isCurrent() || selected === 'cancel') return;
          if (selected === 'retry') continue;
          await logout(selected === 'automatic' ? 'automatic' : 'manual');
          return;
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
