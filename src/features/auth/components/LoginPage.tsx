import React, { useState } from 'react';
import { LoginPageCard } from './LoginPageCard';
import { useLoginPageController } from './useLoginPageController';
import { LoginScreenLayout } from '@/components/ui/LoginScreenLayout';

export interface LoginPageProps {
  onLoginSuccess: () => void;
  initialAuthError?: {
    message: string;
    code?: string | null;
  } | null;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, initialAuthError }) => {
  const [individualBusy, setIndividualBusy] = useState(false);
  const {
    error,
    errorCode,
    isGoogleLoading,
    isAnyLoading,
    isDayGradient,
    canRetryGoogleSignIn,
    handleGoogleSignIn,
    handleLocalResetStart,
    toggleBackgroundMode,
  } = useLoginPageController(onLoginSuccess, initialAuthError);
  return (
    <LoginScreenLayout
      mode={isDayGradient ? 'day' : 'night'}
      testId="login-page"
      authState={isGoogleLoading ? 'google-loading' : individualBusy ? 'rut-loading' : 'idle'}
      onToggleMode={toggleBackgroundMode}
    >
      <LoginPageCard
        isDayGradient={isDayGradient}
        isAnyLoading={isAnyLoading || individualBusy}
        onIndividualLoginSuccess={onLoginSuccess}
        onIndividualBusyChange={setIndividualBusy}
        isGoogleLoading={isGoogleLoading}
        error={error}
        errorCode={errorCode}
        canRetryGoogleSignIn={canRetryGoogleSignIn}
        onGoogleSignIn={() => handleGoogleSignIn()}
        onGoogleCredential={(idToken, isCurrent) => handleGoogleSignIn({ idToken, isCurrent })}
        onLocalResetStart={handleLocalResetStart}
      />
    </LoginScreenLayout>
  );
};
