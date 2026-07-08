/**
 * NavbarMenu Component Tests
 * Tests for the extracted navbar menu dropdown component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavbarMenu } from '@/components/layout/NavbarMenu';

let mockRole = 'admin';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ role: mockRole }),
  useCanEdit: () => true,
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ role: mockRole }),
  useCanEdit: () => true,
}));

describe('NavbarMenu', () => {
  const defaultProps = {
    currentModule: 'CENSUS' as const,
    setModule: vi.fn(),
    censusViewMode: 'REGISTER' as const,
    visibleModules: [
      'CENSUS',
      'DATA',
      'CONFIGURATION',
      'DIAGNOSTICS',
      'COMMUNICATIONS',
      'DATA_MAINTENANCE',
      'PATIENT_MASTER_INDEX',
      'BACKUP_FILES',
    ] as const,
  };

  const openMenu = () => {
    fireEvent.click(screen.getByRole('button', { name: /hospital hanga roa/i }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'admin';
  });

  it('renders brand logo and name', () => {
    render(<NavbarMenu {...defaultProps} />);

    expect(screen.getByText('Hospital Hanga Roa')).toBeInTheDocument();
    expect(screen.queryByText('MODO PRUEBA BETA')).not.toBeInTheDocument();
  });

  it('opens menu when brand button is clicked', () => {
    render(<NavbarMenu {...defaultProps} />);
    openMenu();

    expect(screen.getByText('Configuración')).toBeInTheDocument();
  });

  it('shows admin-only items for admin users', () => {
    mockRole = 'admin';
    render(<NavbarMenu {...defaultProps} />);
    openMenu();

    expect(screen.getByText('Datos')).toBeInTheDocument();
    expect(screen.getByText('Configuración')).toBeInTheDocument();
    expect(screen.getByText('Observabilidad')).toBeInTheDocument();
    expect(screen.getByText('Comunicación')).toBeInTheDocument();
  });

  it('hides admin items for non-admin users', () => {
    mockRole = 'viewer';
    render(<NavbarMenu {...defaultProps} />);
    openMenu();

    expect(screen.queryByText('Datos')).not.toBeInTheDocument();
    expect(screen.queryByText('Configuración')).not.toBeInTheDocument();
    expect(screen.queryByText('Observabilidad')).not.toBeInTheDocument();
  });

  it('shows both prescription modules for hospital nurses', () => {
    mockRole = 'nurse_hospital';
    render(<NavbarMenu {...defaultProps} />);
    openMenu();

    expect(screen.getByText('Recetas — Visor')).toBeInTheDocument();
    expect(screen.getByText('Recetas — Configuración (QR/PIN)')).toBeInTheDocument();
  });

  it('closes menu when backdrop is clicked', () => {
    render(<NavbarMenu {...defaultProps} />);
    openMenu();

    // Click on backdrop (fixed inset element)
    const backdrop = document.querySelector('.fixed.inset-0');
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(screen.queryByText('Configuración')).not.toBeInTheDocument();
    }
  });

  it('shows System Diagnostics (Monitor de Errores) for admin users', () => {
    mockRole = 'admin';
    render(<NavbarMenu {...defaultProps} />);
    openMenu();

    expect(screen.getByText('Observabilidad')).toBeInTheDocument();
  });

  it('changes module when clicking a system module entry', () => {
    render(<NavbarMenu {...defaultProps} />);
    openMenu();

    fireEvent.click(screen.getByText('Comunicación'));

    expect(defaultProps.setModule).toHaveBeenCalledWith('COMMUNICATIONS');
  });

  it('changes module when clicking the settings entry', () => {
    render(<NavbarMenu {...defaultProps} />);
    openMenu();

    fireEvent.click(screen.getByText('Configuración'));

    expect(defaultProps.setModule).toHaveBeenCalledWith('CONFIGURATION');
  });
});
