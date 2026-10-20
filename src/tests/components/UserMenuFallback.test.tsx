import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserMenu } from '@/components/layout/UserMenu';

vi.mock('@/components/layout/UserMenuPanel', () => {
  throw new Error('Synthetic unavailable menu resource');
});
vi.mock('@/services/utils/errorService', () => ({ errorService: { logError: vi.fn() } }));

describe('logout remains available if the menu resource fails', () => {
  afterEach(() => vi.restoreAllMocks());
  it('keeps the avatar and invokes the canonical logout callback without loading the menu', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logout = vi.fn();
    render(<UserMenu userEmail="synthetic@hospital.test" role="admin" onLogout={logout} />);
    fireEvent.click(screen.getByTestId('authenticated-user-menu-button'));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(screen.getByTestId('authenticated-user-menu-button')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(logout).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).not.toBeInTheDocument();
  });
});
