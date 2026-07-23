/**
 * NavbarTabs Component Tests
 * Tests for the extracted navigation tabs component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavbarTabs } from '@/components/layout/NavbarTabs';
import { ModuleType } from '@/constants/navigationConfig';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    role: 'admin',
    user: { email: 'admin@test.com' },
    signOut: vi.fn(),
    isFirebaseConnected: true,
  }),
}));

describe('NavbarTabs', () => {
  const defaultProps = {
    currentModule: 'CENSUS' as ModuleType,
    onModuleChange: vi.fn(),
    visibleModules: [
      'CENSUS',
      'ANALYTICS',
      'CUDYR',
      'NURSING_HANDOFF',
      'MEDICAL_HANDOFF',
      'BACKUP_FILES',
    ] as const,
    censusViewMode: 'REGISTER' as const,
    setCensusViewMode: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders visible main tabs', () => {
    render(<NavbarTabs {...defaultProps} />);

    expect(screen.getByText('Censo Diario')).toBeInTheDocument();
    expect(screen.getByText('Entrega Turno Enfermería')).toBeInTheDocument();
    expect(screen.queryByText('Entrega Turno Médicos')).not.toBeInTheDocument();
  });

  it('shows utility modules in dropdown', () => {
    render(<NavbarTabs {...defaultProps} />);

    // Open dropdown
    const menuBtn = screen.getByTitle('Más módulos');
    fireEvent.click(menuBtn);

    expect(screen.getByText('Estadísticas')).toBeInTheDocument();
  });

  it('renders utility dropdown outside the scrollable tabs container so it is not clipped', () => {
    render(<NavbarTabs {...defaultProps} />);

    fireEvent.click(screen.getByTitle('Más módulos'));

    expect(screen.getByText('Archivos').closest('.overflow-x-auto')).toBeNull();
  });

  it('does not render hidden tabs', () => {
    render(<NavbarTabs {...defaultProps} visibleModules={['CENSUS']} />);

    expect(screen.getByText('Censo Diario')).toBeInTheDocument();
    expect(screen.queryByText('CUDYR')).not.toBeInTheDocument();
  });

  it('calls onModuleChange when tab is clicked', () => {
    render(<NavbarTabs {...defaultProps} />);

    fireEvent.click(screen.getByTitle('Más módulos'));
    fireEvent.click(screen.getByText('Estadísticas'));

    expect(defaultProps.onModuleChange).toHaveBeenCalledWith('ANALYTICS');
    expect(defaultProps.setCensusViewMode).not.toHaveBeenCalled();
  });

  it('changes to a clinical handoff module when clicking a clinical tab', () => {
    render(<NavbarTabs {...defaultProps} />);

    fireEvent.click(screen.getByText('Entrega Turno Enfermería'));

    expect(defaultProps.onModuleChange).toHaveBeenCalledWith('NURSING_HANDOFF');
    expect(defaultProps.setCensusViewMode).not.toHaveBeenCalled();
  });

  it('reapplies register mode when clicking the main census tab', () => {
    render(
      <NavbarTabs {...defaultProps} currentModule="MEDICAL_HANDOFF" censusViewMode="REGISTER" />
    );

    fireEvent.click(screen.getByText('Censo Diario'));

    expect(defaultProps.onModuleChange).toHaveBeenCalledWith('CENSUS');
    expect(defaultProps.setCensusViewMode).toHaveBeenCalledWith('REGISTER');
  });

  it('applies active style to current module and handles CUDYR alias', () => {
    const { rerender } = render(<NavbarTabs {...defaultProps} currentModule="CENSUS" />);
    const censusButton = screen.getByText('Censo Diario').closest('button');
    expect(censusButton?.className).toContain('bg-white/[0.16]');

    // Test CUDYR alias for NURSING_HANDOFF
    rerender(<NavbarTabs {...defaultProps} currentModule="CUDYR" />);
    const nursingButton = screen.getByText('Entrega Turno Enfermería').closest('button');
    expect(nursingButton?.className).toContain('bg-white/[0.16]');
  });

  it('navigates to the standalone analytics module from any current module', () => {
    render(<NavbarTabs {...defaultProps} currentModule="NURSING_HANDOFF" />);

    fireEvent.click(screen.getByTitle('Más módulos'));
    fireEvent.click(screen.getByText('Estadísticas'));

    expect(defaultProps.onModuleChange).toHaveBeenCalledWith('ANALYTICS');
    expect(defaultProps.setCensusViewMode).not.toHaveBeenCalled();
  });

  it('closes utility menu on outside click', () => {
    render(<NavbarTabs {...defaultProps} />);

    const menuBtn = screen.getByTitle('Más módulos');
    fireEvent.click(menuBtn);
    expect(screen.getByText('Estadísticas')).toBeVisible();

    // Click outside
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Estadísticas')).not.toBeInTheDocument();
  });

  it('shows active utility menu state', () => {
    const { rerender } = render(<NavbarTabs {...defaultProps} currentModule="BACKUP_FILES" />);
    const menuBtn = screen.getByTitle('Más módulos');
    expect(menuBtn.className).toContain('bg-white/[0.16]');

    rerender(<NavbarTabs {...defaultProps} currentModule="ANALYTICS" />);
    expect(menuBtn.className).toContain('bg-white/[0.16]');
  });
});
