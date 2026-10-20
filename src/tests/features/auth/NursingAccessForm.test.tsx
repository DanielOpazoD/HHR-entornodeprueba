import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NursingAccessForm from '@/features/auth/components/NursingAccessForm';
import NursingPasswordDialog from '@/components/layout/NursingPasswordDialog';
import { establishNursingSession } from '@/services/auth/nursingAccountService';
vi.mock('@/services/auth/nursingAccountService', () => ({
  establishNursingSession: vi.fn(),
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
    fireEvent.click(screen.getByText('Tengo un código de activación'));
    fireEvent.change(screen.getByLabelText('RUT con dígito verificador'), {
      target: { value: '11.111.111-1' },
    });
    fireEvent.change(screen.getByLabelText('Código privado de activación'), {
      target: { value: 'private-code' },
    });
    fireEvent.change(screen.getByLabelText('Elige tu clave personal'), {
      target: { value: 'personal private phrase' },
    });
    fireEvent.change(screen.getByLabelText('Repite tu nueva clave'), {
      target: { value: 'different private phrase' },
    });
    fireEvent.submit(screen.getByRole('form'));
    expect(establishNursingSession).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Repite tu nueva clave'), {
      target: { value: 'personal private phrase' },
    });
    fireEvent.submit(screen.getByRole('form'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(establishNursingSession).toHaveBeenCalledWith(
      'activateNursingAccount',
      {
        rut: '11.111.111-1',
        activationToken: 'private-code',
        password: 'personal private phrase',
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
    fireEvent.change(screen.getByLabelText('RUT con dígito verificador'), {
      target: { value: '11.111.111-1' },
    });
    fireEvent.change(screen.getByLabelText('Clave'), { target: { value: 'bad-private-password' } });
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
      target: { value: 'new private phrase' },
    });
    fireEvent.change(screen.getByLabelText('Repite la nueva clave'), {
      target: { value: 'new private phrase' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar clave' }));
    await screen.findByText(/Clave cambiada/);
    expect(establishNursingSession).toHaveBeenCalledWith(
      'changeNursingPassword',
      {
        currentPassword: 'old private phrase',
        password: 'new private phrase',
      },
      expect.any(Function)
    );
    expect(screen.getByLabelText('Clave actual')).toHaveValue('');
    expect(screen.getByLabelText('Nueva clave')).toHaveValue('');
  });
});
