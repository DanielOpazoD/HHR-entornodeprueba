import { useEffect, useRef } from 'react';
import type { AuthUser } from '@/types/authRoleTypes';
import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { authStateLogger } from '@/hooks/hookLoggers';

export const useNursingSessionMonitor = (
  user: AuthUser | null,
  handleLogout: (reason?: 'manual' | 'automatic') => Promise<void>
): void => {
  const logoutRef = useRef(handleLogout);
  logoutRef.current = handleLogout;
  useEffect(() => {
    const uid = user?.uid;
    if (!uid?.startsWith('hhrn_')) return;
    const firebaseUser = defaultAuthRuntime.getCurrentUser();
    if (firebaseUser?.uid !== uid) return;
    let active = true;
    let stop = () => {};
    const closeCurrentSession = async () => {
      if (active && defaultAuthRuntime.getCurrentUser() === firebaseUser) {
        // Use the same cleanup, queue ownership fence and broadcast as normal logout.
        await logoutRef.current('automatic');
      }
    };
    void Promise.all([defaultAuthRuntime.ready, import('@/services/auth/nursingSessionMonitor')])
      .then(([, { watchNursingSession }]) => {
        if (active && defaultAuthRuntime.getCurrentUser() === firebaseUser) {
          stop = watchNursingSession(firebaseUser, closeCurrentSession);
        }
      })
      .catch(async () => {
        // A missing monitor must not silently admit an unbounded individual session.
        await closeCurrentSession().catch(error =>
          authStateLogger.warn('Individual session cleanup remains pending', error)
        );
      });
    return () => {
      active = false;
      stop();
    };
  }, [user]);
};
