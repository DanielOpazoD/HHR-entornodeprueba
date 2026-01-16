/**
 * NavbarTabs Component Tests
 * Tests for the extracted navigation tabs component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavbarTabs } from '../../components/layout/NavbarTabs';

describe('NavbarTabs', () => {
    const defaultProps = {
        currentModule: 'CENSUS' as const,
        onModuleChange: vi.fn(),
        visibleModules: ['CENSUS', 'CUDYR', 'NURSING_HANDOFF', 'MEDICAL_HANDOFF'] as const,
        censusViewMode: 'REGISTER' as const,
        setCensusViewMode: vi.fn()
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders visible main tabs', () => {
        render(<NavbarTabs {...defaultProps} />);

        expect(screen.getByText('Censo Diario')).toBeInTheDocument();
        expect(screen.getByText('Entrega Turno Enfermería')).toBeInTheDocument();
        expect(screen.getByText('Entrega Turno Médicos')).toBeInTheDocument();
    });

    it('shows utility modules in dropdown', () => {
        render(<NavbarTabs {...defaultProps} />);

        // Open dropdown
        const menuBtn = screen.getByTitle('Más módulos');
        fireEvent.click(menuBtn);

        expect(screen.getByText('Estadística')).toBeInTheDocument();
    });

    it('does not render hidden tabs', () => {
        render(<NavbarTabs {...defaultProps} visibleModules={['CENSUS']} />);

        expect(screen.getByText('Censo Diario')).toBeInTheDocument();
        expect(screen.queryByText('CUDYR')).not.toBeInTheDocument();
    });

    it('calls onModuleChange when tab is clicked', () => {
        render(<NavbarTabs {...defaultProps} />);

        // Open dropdown for Estadística
        fireEvent.click(screen.getByTitle('Más módulos'));
        fireEvent.click(screen.getByText('Estadística'));

        // It should call setCensusViewMode('ANALYTICS') if not in CENSUS
        // But since default is CENSUS, it toggles
        expect(defaultProps.setCensusViewMode).toHaveBeenCalled();
    });

    it('applies active style to current module', () => {
        const { container } = render(<NavbarTabs {...defaultProps} currentModule="CENSUS" />);

        // The active tab should have different classes (border-white)
        const censusButton = screen.getByText('Censo Diario').closest('button');
        expect(censusButton?.className).toContain('border-white');
    });

    it('renders CENSUS tab correctly', () => {
        render(<NavbarTabs {...defaultProps} />);

        fireEvent.click(screen.getByText('Censo Diario'));
        expect(defaultProps.onModuleChange).toHaveBeenCalledWith('CENSUS');
    });

    it('renders NURSING_HANDOFF tab correctly', () => {
        render(<NavbarTabs {...defaultProps} />);

        fireEvent.click(screen.getByText('Entrega Turno Enfermería'));
        expect(defaultProps.onModuleChange).toHaveBeenCalledWith('NURSING_HANDOFF');
    });

    it('renders MEDICAL_HANDOFF tab correctly', () => {
        render(<NavbarTabs {...defaultProps} />);

        fireEvent.click(screen.getByText('Entrega Turno Médicos'));
        expect(defaultProps.onModuleChange).toHaveBeenCalledWith('MEDICAL_HANDOFF');
    });
});
