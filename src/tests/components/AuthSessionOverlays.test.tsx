import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/context/AuthContext';
import { AuthSessionOverlays } from '@/components/layout/AuthSessionOverlays';
import { resolveNormalizedAuthOperationalState } from '@/services/auth/authOperationalState';
import { useNursingHandoffLogout } from '@/hooks/useNursingHandoffLogout';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import type { AuthUser } from '@/types/authRoleTypes';

vi.unmock('@/context/AuthContext');
const mocks = vi.hoisted(() => ({
  attempt: vi.fn(),
  backup: vi.fn(),
  resume: vi.fn(),
  close: vi.fn(),
  uid: 'synthetic-A',
}));
vi.mock('@/hooks/useAuthClaimRefreshScheduler', () => ({ useAuthClaimRefreshScheduler: vi.fn() }));
vi.mock('@/services/storage/sync/nursingHandoffSession', () => ({
  attemptNursingHandoffLogout: mocks.attempt,
  downloadPendingNursingHandoff: mocks.backup,
  resumeOwnedNursingHandoff: mocks.resume,
}));
vi.mock('@/hooks/useAuthState', () => ({
  useAuthState: () => {
    const user: AuthUser = {
      uid: mocks.uid,
      email: 'synthetic@hospital.test',
      displayName: 'Synthetic nurse',
      role: 'nurse_hospital',
    };
    const logout = useNursingHandoffLogout(user, mocks.close);
    return {
      ...resolveNormalizedAuthOperationalState({
        sessionState: { status: 'authorized', user },
        currentUser: user,
        authorizedUser: user,
        role: user.role,
        handleLogout: logout.handleLogout,
      }),
      logoutPrompt: logout.logoutPrompt,
    };
  },
}));
import { useAuth } from '@/context/AuthContext';

const Route = ({ name }: { name: string }) => {
  const { signOut } = useAuth();
  return <button onClick={() => void signOut()}>{name}</button>;
};
const Surface = ({ name }: { name: string }) => (
  <AuthProvider>
    <Route name={name} />
    <AuthSessionOverlays />
  </AuthProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.uid = 'synthetic-A';
  mocks.attempt.mockResolvedValue(false);
  mocks.close.mockResolvedValue(undefined);
  mocks.resume.mockImplementation(async (owner: string) => [owner]);
  localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic-A');
  setSessionGeneration('synthetic-generation');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
});

afterEach(() => {
  localStorage.clear();
  setSessionGeneration(null);
});

it.each(['censo', 'login', 'firma médica', 'carga pública', 'recetas', 'escáner'])(
  'keeps logout confirmation available independently of the %s route',
  async name => {
    render(<Surface name={name} />);
    fireEvent.click(screen.getByText(name));
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('Entrega de turno sin enviar');
    fireEvent.click(screen.getByText('Cancelar'));
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.backup).not.toHaveBeenCalled();
  }
);

it('resets a dismissed recovery notice when the authorized user changes', async () => {
  const view = render(<Surface name="censo" />);
  expect(await screen.findByRole('status')).toHaveTextContent('user:synthetic-A');
  fireEvent.click(screen.getByLabelText('Cerrar aviso de entrega pendiente'));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  mocks.uid = 'synthetic-B';
  view.rerender(<Surface name="firma médica" />);
  expect(await screen.findByRole('status')).toHaveTextContent('user:synthetic-B');
  expect(screen.getByRole('status')).not.toHaveTextContent('user:synthetic-A');
});

it('does not draw handoff presentation when only the session provider is mounted', async () => {
  render(
    <AuthProvider>
      <Route name="cerrar" />
    </AuthProvider>
  );
  fireEvent.click(screen.getByText('cerrar'));
  await vi.waitFor(() => expect(mocks.attempt).toHaveBeenCalled());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
