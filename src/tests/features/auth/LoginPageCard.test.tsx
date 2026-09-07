import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadGoogleIdentityButton,
  mountGoogleIdentityButton,
} from '@/services/auth/googleIdentityButton';

import { LoginPageCard } from '@/features/auth/components/LoginPageCard';
import { AUTH_UI_COPY } from '@/services/auth/authUiCopy';
import { resetLocalAppStorage } from '@/services/storage/indexeddb/indexedDbMaintenanceService';

const mockConfirm = vi.fn();
vi.mock('@/services/auth/googleIdentityButton', () => ({
  loadGoogleIdentityButton: vi.fn(),
  mountGoogleIdentityButton: vi.fn(),
}));

afterEach(() => vi.unstubAllEnvs());

vi.mock('@/services/storage/indexeddb/indexedDbMaintenanceService', () => ({
  resetLocalAppStorage: vi.fn(),
}));

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: () => ({
    confirm: mockConfirm,
  }),
}));

describe('LoginPageCard', () => {
  const identityProps = {
    isDayGradient: true,
    isAnyLoading: false,
    isGoogleLoading: false,
    error: null,
    errorCode: null,
    onGoogleSignIn: vi.fn(),
    onGoogleCredential: vi.fn().mockResolvedValue(undefined),
  };

  it('shows only the new access in production and disposes it on unmount', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_GOOGLE_SIGN_IN_CLIENT_ID', 'test-client');
    vi.mocked(loadGoogleIdentityButton).mockResolvedValue({} as never);
    const dispose = vi.fn();
    vi.mocked(mountGoogleIdentityButton).mockReturnValue(dispose);
    const { unmount } = render(<LoginPageCard {...identityProps} />);
    await waitFor(() => expect(mountGoogleIdentityButton).toHaveBeenCalled());
    expect(screen.getByTestId('google-identity-sign-in')).toBeInTheDocument();
    expect(screen.queryByTestId('login-google-button')).not.toBeInTheDocument();
    expect(screen.queryByText(/Piloto/)).not.toBeInTheDocument();
    unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('replaces a failed selector with one fallback without starting a popup', async () => {
    vi.stubEnv('VITE_GOOGLE_SIGN_IN_CLIENT_ID', 'test-client');
    vi.mocked(loadGoogleIdentityButton).mockRejectedValue(new Error('Network unavailable'));
    const signIn = vi.fn();
    render(<LoginPageCard {...identityProps} onGoogleSignIn={signIn} />);
    await waitFor(() => expect(screen.getByTestId('login-google-button')).toBeInTheDocument());
    expect(screen.queryByTestId('google-identity-sign-in')).not.toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('login-google-button'));
    expect(signIn).toHaveBeenCalledOnce();
  });

  it('retains a single working fallback when OAuth is not configured', () => {
    vi.stubEnv('VITE_GOOGLE_SIGN_IN_CLIENT_ID', '');
    render(<LoginPageCard {...identityProps} />);
    expect(screen.getAllByTestId('login-google-button')).toHaveLength(1);
    expect(screen.queryByTestId('google-identity-sign-in')).not.toBeInTheDocument();
  });
  it('offers a dedicated local reset button even without an auth error', async () => {
    mockConfirm.mockResolvedValue(true);
    const onLocalResetStart = vi.fn();

    render(
      <LoginPageCard
        isDayGradient
        isAnyLoading={false}
        isGoogleLoading={false}
        error={null}
        errorCode={null}
        canRetryGoogleSignIn={false}
        onGoogleSignIn={vi.fn()}
        onLocalResetStart={onLocalResetStart}
      />
    );

    fireEvent.click(screen.getByTestId('login-reset-local-button'));

    expect(screen.getByText(AUTH_UI_COPY.resetStorageAction)).toBeInTheDocument();
    expect(mockConfirm).toHaveBeenCalledWith({
      title: AUTH_UI_COPY.resetStorageTitle,
      message: AUTH_UI_COPY.resetStorageConfirm,
      confirmText: AUTH_UI_COPY.resetStorageConfirmAction,
      cancelText: 'Volver',
      variant: 'info',
    });
    await waitFor(() => {
      expect(onLocalResetStart).toHaveBeenCalledTimes(1);
      expect(resetLocalAppStorage).toHaveBeenCalledTimes(1);
    });
  });

  it('shows an explicit pending state while Google popup login is in progress', () => {
    render(
      <LoginPageCard
        isDayGradient
        isAnyLoading
        isGoogleLoading
        error={null}
        errorCode={null}
        canRetryGoogleSignIn={false}
        onGoogleSignIn={vi.fn()}
      />
    );

    expect(screen.getByText('Conectando con Google...')).toBeInTheDocument();
    expect(screen.getAllByText(AUTH_UI_COPY.popupPendingTitle)).toHaveLength(1);
    expect(screen.getByTestId('login-google-pending')).toHaveTextContent(
      AUTH_UI_COPY.popupPendingHint
    );
  });

  it('offers a retry action when access validation fails temporarily', () => {
    const onGoogleSignIn = vi.fn();

    render(
      <LoginPageCard
        isDayGradient
        isAnyLoading={false}
        isGoogleLoading={false}
        error="No se pudo validar tu acceso en este momento. Intenta nuevamente en unos segundos."
        errorCode="auth/role-validation-unavailable"
        canRetryGoogleSignIn
        onGoogleSignIn={onGoogleSignIn}
      />
    );

    fireEvent.click(screen.getByTestId('login-retry-button'));

    expect(screen.getByText(AUTH_UI_COPY.roleValidationRetryHint)).toBeInTheDocument();
    expect(onGoogleSignIn).toHaveBeenCalledTimes(1);
  });
});
