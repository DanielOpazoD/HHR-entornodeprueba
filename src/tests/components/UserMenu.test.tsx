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
    onLogout: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders user initial button', () => {
    render(<UserMenu {...defaultProps} />);

    const button = screen.getByRole('button');
    expect(button.textContent).toBe('d');
  });

  it('shows dropdown when button is clicked', () => {
    render(<UserMenu {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Usuario')).toBeInTheDocument();
    expect(screen.getByText('doctor@hospital.cl')).toBeInTheDocument();
  });

  it('displays role correctly', () => {
    render(<UserMenu {...defaultProps} role="admin" />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText(/Rol:/)).toBeInTheDocument();
  });

  it('calls onLogout when logout button is clicked', () => {
    render(<UserMenu {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Cerrar sesión'));

    expect(defaultProps.onLogout).toHaveBeenCalled();
  });

  it('closes dropdown after logout', () => {
    render(<UserMenu {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Cerrar sesión'));

    // Dropdown should be closed
    expect(screen.queryByText('Usuario')).not.toBeInTheDocument();
  });

  it('has correct title attribute with email', () => {
    render(<UserMenu {...defaultProps} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('title', 'doctor@hospital.cl');
  });

  it('shows first letter uppercase', () => {
    render(<UserMenu {...defaultProps} userEmail="Admin@hospital.cl" />);

    const button = screen.getByRole('button');
    expect(button.textContent).toBe('A');
  });

  it('closes dropdown when clicking outside', () => {
    render(<UserMenu {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Usuario')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Usuario')).not.toBeInTheDocument();
  });
});
