import React, { lazy, Suspense } from 'react';
import { useAuth } from '@/context/AuthContext';

const NursingHandoffLogoutDialog = lazy(() => import('./NursingHandoffLogoutDialog'));
const NursingHandoffSessionNotice = lazy(() => import('./NursingHandoffSessionNotice'));

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
