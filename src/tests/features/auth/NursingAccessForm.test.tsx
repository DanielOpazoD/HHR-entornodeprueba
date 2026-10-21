import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NursingAccessForm from '@/features/auth/components/NursingAccessForm';
import NursingPasswordDialog from '@/components/layout/NursingPasswordDialog';
import { establishNursingSession, callAccount } from '@/services/auth/nursingAccountService';
vi.mock('@/services/auth/nursingAccountService', () => ({
  establishNursingSession: vi.fn(),
  callAccount: vi.fn(),
  accountErrorMessage: () => 'No se pudo completar el acceso.',
}));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
describe('private individual access forms', () => {
  it('requires private activation and matching password, clears secrets and never writes browser storage', async () => {
    vi.mocked(establishNursingSession).mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    render(<NursingAccessForm onSuccess={onSuccess} />);
    fireEvent.click(screen.getByText('¿Es tu primer ingreso?'));
    fireEvent.click(screen.getByText('Tengo un código de activación'));
    fireEvent.change(screen.getByLabelText('Usuario'), {
      target: { value: '11.111.111-1' },
    });
    fireEvent.change(screen.getByLabelText('Código privado de activación'), {
      target: { value: 'private-code' },
    });
    fireEvent.change(screen.getByLabelText('Elige tu clave personal'), {
      target: { value: 'Personal private phrase 1' },
    });
    fireEvent.change(screen.getByLabelText('Repite tu nueva clave'), {
      target: { value: 'different private phrase' },
    });
    fireEvent.submit(screen.getByRole('form'));
    expect(establishNursingSession).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Repite tu nueva clave'), {
      target: { value: 'Personal private phrase 1' },
    });
    fireEvent.change(screen.getByLabelText('Correo de recuperación'), {
      target: { value: 'nurse@example.invalid' },
    });
    fireEvent.submit(screen.getByRole('form'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(establishNursingSession).toHaveBeenCalledWith(
      'activateNursingAccount',
      {
        rut: '111111111',
        activationToken: 'private-code',
        recoveryEmail: 'nurse@example.invalid',
        password: 'Personal private phrase 1',
      },
      expect.any(Function)
    );
    expect(screen.getByLabelText('Código privado de activación')).toHaveValue('');
    expect(screen.getByLabelText('Elige tu clave personal')).toHaveValue('');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  it('shows generic errors without granting a session or switching to Google automatically', async () => {
    vi.mocked(establishNursingSession).mockRejectedValue(new Error('private provider detail'));
    const onSuccess = vi.fn();
    render(<NursingAccessForm onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText('Usuario'), {
      target: { value: '11.111.111-1' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'bad-private-password' },
    });
    fireEvent.submit(screen.getByRole('form'));
    await screen.findByRole('alert');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.queryByText(/private provider detail/)).not.toBeInTheDocument();
  });
  it('requires the previous password for a private change and clears all password fields afterwards', async () => {
    vi.mocked(establishNursingSession).mockResolvedValue(undefined);
    render(<NursingPasswordDialog onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Clave actual'), {
      target: { value: 'old private phrase' },
    });
    fireEvent.change(screen.getByLabelText('Nueva clave'), {
      target: { value: 'New private phrase 1' },
    });
    fireEvent.change(screen.getByLabelText('Repite la nueva clave'), {
      target: { value: 'New private phrase 1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar clave' }));
    await screen.findByText(/Clave cambiada/);
    expect(establishNursingSession).toHaveBeenCalledWith(
      'changeNursingPassword',
      {
        currentPassword: 'old private phrase',
        password: 'New private phrase 1',
      },
      expect.any(Function)
    );
    expect(screen.getByLabelText('Clave actual')).toHaveValue('');
    expect(screen.getByLabelText('Nueva clave')).toHaveValue('');
  });
  it('shows setup without granting a session and requires email and a personal password', async () => {
    vi.mocked(establishNursingSession).mockResolvedValueOnce({
      requiresSetup: true,
      activationToken: 'setup-only',
    });
    const onSuccess = vi.fn();
    render(<NursingAccessForm onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText('Usuario'), {
      target: { value: '17.752.753-K' },
    });
    expect(screen.getByLabelText('Usuario')).toHaveValue('17752753k');
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: '17752753' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('type', 'text');
    fireEvent.submit(screen.getByRole('form'));
    await screen.findByText('Primer ingreso: cambia tu clave');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Elige tu clave personal')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Elige tu clave personal')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Elige tu clave personal'), {
      target: { value: 'Clave1' },
    });
    fireEvent.change(screen.getByLabelText('Repite tu nueva clave'), {
      target: { value: 'Clave1' },
    });
    fireEvent.change(screen.getByLabelText('Correo de recuperación'), {
      target: { value: 'nurse@example.invalid' },
    });
    vi.mocked(establishNursingSession).mockResolvedValueOnce(undefined);
    fireEvent.submit(screen.getByRole('form'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(establishNursingSession).toHaveBeenLastCalledWith(
      'activateNursingAccount',
      {
        rut: '17752753k',
        password: 'Clave1',
        activationToken: 'setup-only',
        recoveryEmail: 'nurse@example.invalid',
      },
      expect.any(Function)
    );
  });
  it('requests a code without disclosing a mailbox and resets only with the server challenge', async () => {
    vi.mocked(callAccount).mockResolvedValue({ challengeId: 'opaque-challenge' });
    vi.mocked(establishNursingSession).mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    render(<NursingAccessForm onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
    fireEvent.change(screen.getByLabelText('Usuario'), {
      target: { value: '111111111' },
    });
    fireEvent.submit(screen.getByRole('form'));
    await screen.findByLabelText('Código de recuperación');
    expect(onSuccess).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Código de recuperación'), {
      target: { value: '12345678' },
    });
    fireEvent.change(screen.getByLabelText('Elige tu clave personal'), {
      target: { value: 'Nueva1' },
    });
    fireEvent.change(screen.getByLabelText('Repite tu nueva clave'), {
      target: { value: 'Nueva1' },
    });
    fireEvent.submit(screen.getByRole('form'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(establishNursingSession).toHaveBeenLastCalledWith(
      'resetNursingPassword',
      {
        rut: '111111111',
        password: 'Nueva1',
        code: '12345678',
        challengeId: 'opaque-challenge',
      },
      expect.any(Function)
    );
  });
});
