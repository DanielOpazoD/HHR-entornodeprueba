import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LoginPageCard } from '@/features/auth/components/LoginPageCard';
import { AUTH_UI_COPY } from '@/services/auth/authUiCopy';
import { resetLocalAppStorage } from '@/services/storage/indexeddb/indexedDbMaintenanceService';

const mockConfirm = vi.fn();

vi.mock('@/services/storage/indexeddb/indexedDbMaintenanceService', () => ({
  resetLocalAppStorage: vi.fn(),
}));

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: () => ({
    confirm: mockConfirm,
  }),
}));

describe('LoginPageCard', () => {
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
