import { Suspense } from 'react';
import { lazyWithRetry } from '@/components/ui/lazyWithRetry';
import { useAuth } from '@/context/AuthContext';

const NursingHandoffLogoutDialog = lazyWithRetry(() => import('./NursingHandoffLogoutDialog'));
const NursingHandoffSessionNotice = lazyWithRetry(() => import('./NursingHandoffSessionNotice'));

export const AuthSessionOverlays = () => {
  const { logoutPrompt, authorizedUser } = useAuth();
  return (
    <Suspense fallback={null}>
      {logoutPrompt && <NursingHandoffLogoutDialog {...logoutPrompt} />}
      {authorizedUser && (
        <NursingHandoffSessionNotice key={authorizedUser.uid} uid={authorizedUser.uid} />
      )}
    </Suspense>
  );
};
