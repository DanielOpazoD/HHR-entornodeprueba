/**
 * NavbarMenu Component Tests
 * Tests for the extracted navbar menu dropdown component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavbarMenu } from '@/components/layout/NavbarMenu';

// Mock dependencies
vi.mock('../../context/DailyRecordContext', () => ({
  useDailyRecordContext: () => ({ record: null }),
}));

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
    onOpenSettings: vi.fn(),
    visibleModules: ['CENSUS', 'CUDYR', 'NURSING_HANDOFF', 'MEDICAL_HANDOFF'] as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'admin';
  });

  it('renders brand logo and name', () => {
    render(<NavbarMenu {...defaultProps} />);

    expect(screen.getByText('Hospital Hanga Roa')).toBeInTheDocument();
    expect(screen.getByText('MODO PRUEBA')).toBeInTheDocument();
  });

  it('opens menu when brand button is clicked', () => {
    render(<NavbarMenu {...defaultProps} />);

    const brandButton = screen
      .queryByRole('heading', { name: /Hospital Hanga Roa/i })
      ?.closest('button');
    if (brandButton) fireEvent.click(brandButton);

    expect(screen.getByText('Configuración')).toBeInTheDocument();
  });

  it('shows admin-only items for admin users', () => {
    mockRole = 'admin';
    render(<NavbarMenu {...defaultProps} />);
    const brandButton = screen
      .queryByRole('heading', { name: /Hospital Hanga Roa/i })
      ?.closest('button');
    if (brandButton) fireEvent.click(brandButton);

    expect(screen.getByText('Configuración')).toBeInTheDocument();
    expect(screen.getByText('Auditoría')).toBeInTheDocument();
  });

  it('hides admin items for non-admin users', () => {
    mockRole = 'user';
    render(<NavbarMenu {...defaultProps} />);
    const brandButton = screen
      .queryByRole('heading', { name: /Hospital Hanga Roa/i })
      ?.closest('button');
    if (brandButton) fireEvent.click(brandButton);

    expect(screen.queryByText('Configuración')).not.toBeInTheDocument();
    expect(screen.queryByText('Auditoría')).not.toBeInTheDocument();
  });

  it('closes menu when backdrop is clicked', () => {
    render(<NavbarMenu {...defaultProps} />);
    const brandButton = screen
      .queryByRole('heading', { name: /Hospital Hanga Roa/i })
      ?.closest('button');
    if (brandButton) fireEvent.click(brandButton);

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
    const brandButton = screen
      .queryByRole('heading', { name: /Hospital Hanga Roa/i })
      ?.closest('button');
    if (brandButton) fireEvent.click(brandButton);

    expect(screen.getByText('Diagnóstico del Sistema')).toBeInTheDocument();
  });
});
