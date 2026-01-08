/**
 * NavbarMenu Component Tests
 * Tests for the extracted navbar menu dropdown component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavbarMenu } from '../../components/layout/NavbarMenu';

// Mock dependencies
vi.mock('../../context/DailyRecordContext', () => ({
    useDailyRecordContext: () => ({ record: null })
}));

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ role: 'admin' })
}));

describe('NavbarMenu', () => {
    const defaultProps = {
        isOpen: false,
        onToggle: vi.fn(),
        onClose: vi.fn(),
        currentModule: 'CENSUS' as const,
        setModule: vi.fn(),
        censusViewMode: 'REGISTER' as const,
        setCensusViewMode: vi.fn(),
        onExportJSON: vi.fn(),
        onImportClick: vi.fn(),
        onOpenSettings: vi.fn(),
        isUserAdmin: true,
        visibleModules: ['CENSUS', 'CUDYR', 'NURSING_HANDOFF', 'MEDICAL_HANDOFF'] as const
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders brand logo and name', () => {
        render(<NavbarMenu {...defaultProps} />);

        expect(screen.getByText('Hospital Hanga Roa')).toBeInTheDocument();
        expect(screen.getByText('MODO PRUEBA')).toBeInTheDocument();
    });

    it('calls onToggle when brand button is clicked', () => {
        render(<NavbarMenu {...defaultProps} />);

        const brandButton = screen.getByRole('button');
        fireEvent.click(brandButton);

        expect(defaultProps.onToggle).toHaveBeenCalled();
    });

    it('shows menu items when isOpen is true', () => {
        render(<NavbarMenu {...defaultProps} isOpen={true} />);

        expect(screen.getByText('Estadística')).toBeInTheDocument();
    });

    it('shows admin-only items for admin users', () => {
        render(<NavbarMenu {...defaultProps} isOpen={true} isUserAdmin={true} />);

        expect(screen.getByText('Configuración')).toBeInTheDocument();
        expect(screen.getByText('Auditoría')).toBeInTheDocument();
    });

    it('hides admin items for non-admin users', () => {
        render(<NavbarMenu {...defaultProps} isOpen={true} isUserAdmin={false} />);

        expect(screen.queryByText('Configuración')).not.toBeInTheDocument();
        expect(screen.queryByText('Auditoría')).not.toBeInTheDocument();
    });

    it('calls onClose when backdrop is clicked', () => {
        render(<NavbarMenu {...defaultProps} isOpen={true} />);

        // Click on backdrop (fixed inset element)
        const backdrop = document.querySelector('.fixed.inset-0');
        if (backdrop) {
            fireEvent.click(backdrop);
            expect(defaultProps.onClose).toHaveBeenCalled();
        }
    });

    it('toggles analytics view when statistic is clicked', () => {
        render(<NavbarMenu {...defaultProps} isOpen={true} currentModule="CENSUS" censusViewMode="REGISTER" />);

        fireEvent.click(screen.getByText('Estadística'));

        expect(defaultProps.setCensusViewMode).toHaveBeenCalledWith('ANALYTICS');
    });

    it('shows Error Monitor for admin users', () => {
        render(<NavbarMenu {...defaultProps} isOpen={true} isUserAdmin={true} />);

        expect(screen.getByText('Monitor de Errores')).toBeInTheDocument();
    });
});
