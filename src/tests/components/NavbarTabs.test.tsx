/**
 * NavbarTabs Component Tests
 * Tests for the extracted navigation tabs component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NavbarTabs } from '@/components/layout/NavbarTabs';
import { ModuleType } from '@/constants/navigationConfig';

vi.mock('@/context/AuthContext', () => ({
    useAuth: () => ({
        role: 'admin',
        user: { email: 'admin@test.com' },
        signOut: vi.fn(),
        isFirebaseConnected: true,
        canDownloadPassport: true,
        handleDownloadPassport: vi.fn(),
        isOfflineMode: false
    })
}));

describe('NavbarTabs', () => {
    const defaultProps = {
        currentModule: 'CENSUS' as ModuleType,
        onModuleChange: vi.fn(),
        visibleModules: ['CENSUS', 'CUDYR', 'NURSING_HANDOFF', 'MEDICAL_HANDOFF', 'BACKUP_FILES'] as const,
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

    it('applies active style to current module and handles CUDYR alias', () => {
        const { rerender } = render(<NavbarTabs {...defaultProps} currentModule="CENSUS" />);
        const censusButton = screen.getByText('Censo Diario').closest('button');
        expect(censusButton?.className).toContain('border-white');

        // Test CUDYR alias for NURSING_HANDOFF
        rerender(<NavbarTabs {...defaultProps} currentModule="CUDYR" />);
        const nursingButton = screen.getByText('Entrega Turno Enfermería').closest('button');
        expect(nursingButton?.className).toContain('border-white');
    });

    it('handles ANALYTICS_TOGGLE from non-CENSUS module', async () => {
        vi.useFakeTimers();
        render(<NavbarTabs {...defaultProps} currentModule="NURSING_HANDOFF" />);

        // Open utility menu and click Estadística (which has ANALYTICS_TOGGLE)
        fireEvent.click(screen.getByTitle('Más módulos'));
        fireEvent.click(screen.getByText('Estadística'));

        expect(defaultProps.onModuleChange).toHaveBeenCalledWith('CENSUS');

        // Fast-forward timeout
        await act(async () => {
            vi.runAllTimers();
        });

        expect(defaultProps.setCensusViewMode).toHaveBeenCalledWith('ANALYTICS');
        vi.useRealTimers();
    });

    it('toggles census view mode when clicking ANALYTICS_TOGGLE in CENSUS module', () => {
        const { rerender } = render(<NavbarTabs {...defaultProps} currentModule="CENSUS" censusViewMode="REGISTER" />);

        fireEvent.click(screen.getByTitle('Más módulos'));
        fireEvent.click(screen.getByText('Estadística'));

        expect(defaultProps.setCensusViewMode).toHaveBeenCalledWith('ANALYTICS');

        rerender(<NavbarTabs {...defaultProps} currentModule="CENSUS" censusViewMode="ANALYTICS" />);
        fireEvent.click(screen.getByTitle('Más módulos'));
        fireEvent.click(screen.getByText('Estadística'));

        expect(defaultProps.setCensusViewMode).toHaveBeenCalledWith('REGISTER');
    });

    it('closes utility menu on outside click', () => {
        render(<NavbarTabs {...defaultProps} />);

        const menuBtn = screen.getByTitle('Más módulos');
        fireEvent.click(menuBtn);
        expect(screen.getByText('Estadística')).toBeVisible();

        // Click outside
        fireEvent.mouseDown(document.body);
        expect(screen.queryByText('Estadística')).not.toBeInTheDocument();
    });

    it('shows active utility menu state', () => {
        // useNavbarNavigation mock or real hook will determine isUtilityActive
        // Testing the branch for line 135 in NavbarTabs.tsx
        const { rerender } = render(<NavbarTabs {...defaultProps} currentModule="BACKUP_FILES" />);
        const menuBtn = screen.getByTitle('Más módulos');
        expect(menuBtn.className).toContain('bg-white/20'); // isUtilityActive should be true for BACKUP_FILES

        rerender(<NavbarTabs {...defaultProps} currentModule="CUDYR" />);
        expect(menuBtn.className).toContain('bg-white/20'); // currentModule === 'CUDYR' condition
    });
});
