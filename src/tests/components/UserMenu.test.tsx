/**
 * UserMenu Component Tests
 * Tests for the extracted user menu dropdown component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserMenu } from '@/components/layout/UserMenu';

describe('UserMenu', () => {
  const defaultProps = {
    userEmail: 'doctor@hospital.cl',
    role: 'editor' as const,
    isFirebaseConnected: true,
    onLogout: vi.fn(),
    onOpenAvatarSettings: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders user initial button', async () => {
    render(<UserMenu {...defaultProps} />);

    const button = screen.getByRole('button');
    expect(button.textContent).toBe('d');
  });

  it('shows the complete menu on the first click without an intermediate logout-only panel', async () => {
    render(<UserMenu {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).not.toBeInTheDocument();
    await screen.findByTestId('user-profile-menu-panel');
    expect(screen.getByTestId('user-profile-menu-panel')).toBeVisible();
    expect(screen.getByText('doctor@hospital.cl')).toBeInTheDocument();
    expect(screen.getByText('Invitado')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar foto de perfil' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  });

  it('displays role correctly', async () => {
    render(<UserMenu {...defaultProps} role="admin" />);

    fireEvent.click(screen.getByRole('button'));
    await screen.findByTestId('user-profile-menu-panel');

    expect(screen.getByText('Administrador')).toBeInTheDocument();
  });

  it('calls onLogout when logout button is clicked', async () => {
    render(<UserMenu {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));
    await screen.findByTestId('user-profile-menu-panel');
    fireEvent.click(screen.getByText('Cerrar sesión'));

    expect(defaultProps.onLogout).toHaveBeenCalled();
  });

  it('closes dropdown after logout', async () => {
    render(<UserMenu {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));
    await screen.findByTestId('user-profile-menu-panel');
    fireEvent.click(screen.getByText('Cerrar sesión'));

    // Dropdown should be closed
    expect(screen.queryByText('doctor@hospital.cl')).not.toBeInTheDocument();
  });

  it('has correct title attribute with email', async () => {
    render(<UserMenu {...defaultProps} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('title', 'doctor@hospital.cl');
  });

  it('exposes user, role and sync state through the authenticated menu button name', async () => {
    render(<UserMenu {...defaultProps} role="admin" />);

    expect(
      screen.getByRole('button', {
        name: 'Usuario doctor@hospital.cl. Rol Administrador. Firebase Online',
      })
    ).toBeInTheDocument();
  });

  it('shows first letter uppercase', async () => {
    render(<UserMenu {...defaultProps} userEmail="Admin@hospital.cl" />);

    const button = screen.getByRole('button');
    expect(button.textContent).toBe('A');
  });

  it('keeps a stable user mark under the saved avatar while the image loads', async () => {
    render(<UserMenu {...defaultProps} avatarUrl="https://storage.test/avatar.png" />);

    expect(screen.getByAltText('Foto de perfil de doctor@hospital.cl')).toHaveAttribute(
      'src',
      'https://storage.test/avatar.png'
    );
    expect(screen.getByTestId('user-avatar-initial-fallback')).toHaveTextContent('d');
  });

  it('renders the expanded profile menu from the avatar with preview, status and actions', async () => {
    render(<UserMenu {...defaultProps} avatarUrl="https://storage.test/avatar.png" />);

    fireEvent.click(screen.getByRole('button'));
    await screen.findByTestId('user-profile-menu-panel');

    expect(screen.getByTestId('user-profile-menu-panel')).toHaveClass('origin-top-right');
    expect(screen.getByTestId('user-profile-menu-preview')).toHaveClass('h-16', 'w-16');
    expect(
      screen.getByTestId('user-profile-menu-preview').querySelector('.absolute.right-1.top-1')
    ).toBeNull();
    expect(screen.getAllByAltText('Foto de perfil de doctor@hospital.cl')).toHaveLength(2);
    expect(screen.getByText('doctor@hospital.cl')).toBeInTheDocument();
    expect(screen.getByText('Invitado')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar foto de perfil' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  it('opens avatar settings from the user dropdown', async () => {
    render(<UserMenu {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));
    await screen.findByTestId('user-profile-menu-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar foto de perfil' }));

    expect(defaultProps.onOpenAvatarSettings).toHaveBeenCalled();
    expect(screen.queryByText('doctor@hospital.cl')).not.toBeInTheDocument();
  });

  it('shows offline state in dropdown when not connected', async () => {
    render(<UserMenu {...defaultProps} isFirebaseConnected={false} />);

    fireEvent.click(screen.getByRole('button'));
    await screen.findByTestId('user-profile-menu-panel');

    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('surfaces local-only sync state even if Firebase is connected', async () => {
    render(<UserMenu {...defaultProps} remoteSyncStatus="local_only" />);

    expect(
      screen.getByRole('button', {
        name: 'Usuario doctor@hospital.cl. Rol Invitado. Firebase Local',
      })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));
    await screen.findByTestId('user-profile-menu-panel');
    expect(screen.getByText('Local')).toBeInTheDocument();
  });

  it('closes dropdown when clicking outside', async () => {
    render(<UserMenu {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));
    await screen.findByTestId('user-profile-menu-panel');
    expect(screen.getByText('doctor@hospital.cl')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('doctor@hospital.cl')).not.toBeInTheDocument();
  });
  it('shows the individual name and password action without disclosing the internal login alias', async () => {
    render(
      <UserMenu
        {...defaultProps}
        userEmail="opaque@accounts.hhr.invalid"
        displayName="Enfermera Sintética"
        isIndividualAccount
      />
    );
    fireEvent.click(screen.getByRole('button'));
    await screen.findByTestId('user-profile-menu-panel');
    expect(screen.getByText('Enfermera Sintética')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar mi clave' })).toBeInTheDocument();
    expect(screen.queryByText('opaque@accounts.hhr.invalid')).not.toBeInTheDocument();
  });
});
