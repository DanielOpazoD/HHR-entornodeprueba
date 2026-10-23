import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NursingAccountsPanel from '@/features/admin/components/NursingAccountsPanel';
import { callAccount } from '@/services/auth/nursingAccountService';
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), role: 'admin' }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ role: mocks.role }) }));
vi.mock('@/context/UIContext', () => ({ useConfirmDialog: () => ({ confirm: mocks.confirm }) }));
vi.mock('@/services/auth/nursingAccountService', () => ({
  callAccount: vi.fn(),
  accountErrorMessage: () => 'Error de prueba',
}));
const account = {
  uid: 'synthetic-id',
  name: 'Persona Sintética',
  rut: '11111111-1',
  role: 'nurse_hospital',
  recoveryEmail: 'synthetic@example.invalid',
  status: 'active',
  recoveryRequired: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'admin';
  mocks.confirm.mockResolvedValue(true);
  vi.mocked(callAccount).mockImplementation(async name =>
    name === 'listNursingAccounts'
      ? { accounts: [account], individualOnly: false, recentAudit: [] }
      : { success: true }
  );
});
describe('individual account administration UI', () => {
  it('shows recovery email, role and four clear actions with legacy transition collapsed', async () => {
    render(<NursingAccountsPanel />);
    expect(await screen.findByText('synthetic@example.invalid')).toBeVisible();
    expect(screen.getByText('Enfermería Hospitalaria')).toBeVisible();
    for (const name of ['Modificar', 'Resetear', 'Deshabilitar', 'Eliminar'])
      expect(screen.getByRole('button', { name })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Nueva activación' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cerrar sesiones' })).toBeNull();
    expect(
      screen.getByText('Opciones de transición de accesos').closest('details')
    ).not.toHaveAttribute('open');
  });
  it.each([
    ['Resetear', 'reset'],
    ['Deshabilitar', 'suspend'],
    ['Eliminar', 'delete'],
  ])('%s confirms and sends its actual operation', async (label, action) => {
    render(<NursingAccountsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: label }));
    await waitFor(() =>
      expect(callAccount).toHaveBeenCalledWith('manageNursingAccount', {
        uid: 'synthetic-id',
        action,
      })
    );
    expect(mocks.confirm).toHaveBeenCalledOnce();
  });
  it('modifies only name and role, keeping the identifier bound to the selected row', async () => {
    render(<NursingAccountsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Modificar' }));
    const form = screen.getByRole('form', { name: /Modificar usuario/ });
    fireEvent.change(within(form).getByLabelText('Nombre completo'), {
      target: { value: 'Nombre Corregido' },
    });
    fireEvent.change(within(form).getByLabelText('Rol'), { target: { value: 'viewer' } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(callAccount).toHaveBeenCalledWith('manageNursingAccount', {
        uid: 'synthetic-id',
        action: 'update',
        name: 'Nombre Corregido',
        role: 'viewer',
      })
    );
  });
  it('a cancelled confirmation makes no mutation', async () => {
    mocks.confirm.mockResolvedValue(false);
    render(<NursingAccountsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(
      vi.mocked(callAccount).mock.calls.every(([name]) => name === 'listNursingAccounts')
    ).toBe(true);
  });
});
