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
vi.mock('@/services/auth/nursingAccountService', () => ({
  callAccount: vi.fn(),
  establishNursingSession: vi.fn(),
  accountErrorMessage: () => 'No se pudo ingresar.',
}));
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

  it('shows username, password and recovery immediately while Google stays a separate action', async () => {
    vi.stubEnv('VITE_GOOGLE_SIGN_IN_CLIENT_ID', '');
    const signIn = vi.fn();
    const { rerender } = render(
      <LoginPageCard
        {...identityProps}
        onGoogleSignIn={signIn}
        onIndividualLoginSuccess={vi.fn()}
      />
    );
    expect(screen.getByRole('form')).toBeVisible();
    expect(screen.getByLabelText('Usuario')).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByRole('form')).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: /^Ingresar$/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Olvidé mi contraseña' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Primer ingreso' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /activar cuenta/ })).not.toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('type', 'text');
    rerender(
      <LoginPageCard
        {...identityProps}
        isAnyLoading
        isGoogleLoading
        onIndividualLoginSuccess={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Usuario')).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Ingresar$/ })).toBeDisabled();
  });

  it('keeps both first-entry paths and exposes activation as a separate action', () => {
    vi.stubEnv('VITE_GOOGLE_SIGN_IN_CLIENT_ID', '');
    render(<LoginPageCard {...identityProps} onIndividualLoginSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Primer ingreso' }));

    expect(
      screen.getByText(
        'Si es tu primera vez, ingresa con tu RUT como usuario y usa los números del RUT, sin dígito verificador, como clave inicial.'
      )
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Tengo un código de activación' }));

    expect(screen.getByText('Activa tu acceso privado')).toBeVisible();
    expect(screen.getByLabelText('Código privado de activación')).toBeVisible();
    expect(
      screen.getByText(
        'Si administración te entregó un código, ingrésalo aquí. Si no lo tienes, vuelve al ingreso y usa los números de tu RUT, sin dígito verificador, como clave inicial.'
      )
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Volver al ingreso' })).toBeVisible();
  });

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

    fireEvent.click(screen.getByText('Ayuda de acceso'));
    fireEvent.click(screen.getByTestId('login-reset-local-button'));

    await waitFor(() =>
      expect(screen.getByText(AUTH_UI_COPY.resetStorageAction)).toBeInTheDocument()
    );
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

  it('keeps credentials and skips maintenance when the reset confirmation is cancelled', async () => {
    vi.mocked(resetLocalAppStorage).mockClear();
    let answer!: (confirmed: boolean) => void;
    mockConfirm.mockImplementationOnce(
      () =>
        new Promise<boolean>(resolve => {
          answer = resolve;
        })
    );
    const resetStarted = vi.fn();
    render(
      <LoginPageCard
        {...identityProps}
        onIndividualLoginSuccess={vi.fn()}
        onLocalResetStart={resetStarted}
      />
    );
    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: '111111111' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'Synthetic example 1' },
    });
    fireEvent.click(screen.getByText('Ayuda de acceso'));
    fireEvent.click(screen.getByTestId('login-reset-local-button'));
    expect(screen.getByLabelText('Usuario')).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Ingresar$/ })).toBeDisabled();
    answer(false);
    await waitFor(() => expect(screen.getByLabelText('Usuario')).toBeEnabled());
    expect(resetLocalAppStorage).not.toHaveBeenCalled();
    expect(resetStarted).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Usuario')).toHaveValue('111111111');
    expect(screen.getByLabelText('Contraseña')).toHaveValue('Synthetic example 1');
  });

  it('shows a recoverable support error and unlocks entry when maintenance fails', async () => {
    vi.mocked(resetLocalAppStorage).mockRejectedValueOnce(new Error('private maintenance detail'));
    mockConfirm.mockResolvedValueOnce(true);
    render(<LoginPageCard {...identityProps} onIndividualLoginSuccess={vi.fn()} />);
    fireEvent.click(screen.getByText('Ayuda de acceso'));
    fireEvent.click(screen.getByTestId('login-reset-local-button'));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar el reinicio');
    expect(screen.queryByText('private maintenance detail')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Usuario')).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Ingresar$/ })).toBeEnabled();
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
