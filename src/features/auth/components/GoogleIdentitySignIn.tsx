import React, { useEffect, useRef } from 'react';
import {
  loadGoogleIdentityButton,
  mountGoogleIdentityButton,
} from '@/services/auth/googleIdentityButton';

interface Props {
  onCredential: (idToken: string, isCurrent: () => boolean) => Promise<void>;
  disabled: boolean;
  onUnavailable: () => void;
}

export const GoogleIdentitySignIn: React.FC<Props> = ({
  onCredential,
  disabled,
  onUnavailable,
}) => {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  useEffect(() => {
    callback.current = onCredential;
  }, [onCredential]);
  useEffect(() => {
    let active = true;
    let dispose = () => {};
    void loadGoogleIdentityButton()
      .then(api => {
        if (!active || !container.current) return;
        dispose = mountGoogleIdentityButton(
          api,
          container.current,
          import.meta.env.VITE_GOOGLE_SIGN_IN_CLIENT_ID || '',
          (token, isCurrent) => callback.current(token, isCurrent)
        );
      })
      .catch(() => {
        if (active) onUnavailable();
      });
    return () => {
      active = false;
      dispose();
    };
  }, [onUnavailable]);

  return (
    <div className="text-center" data-testid="google-identity-sign-in">
      <div ref={container} inert={disabled || undefined} className="flex min-h-10 justify-center" />
    </div>
  );
};
