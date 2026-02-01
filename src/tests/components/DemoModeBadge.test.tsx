/**
 * DemoModeBadge Component Tests
 * Tests for the demo mode indicator component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DemoModeBadge } from '@/components/layout/DemoModeBadge';

// Mock DemoModeContext
const mockUseDemoMode = vi.fn();
vi.mock('../../context/DemoModeContext', () => ({
    useDemoMode: () => mockUseDemoMode()
}));

describe('DemoModeBadge', () => {
    it('renders nothing when demo mode is inactive', () => {
        mockUseDemoMode.mockReturnValue({ isActive: false });

        const { container } = render(<DemoModeBadge />);
        expect(container.firstChild).toBeNull();
    });

    it('renders badge when demo mode is active', () => {
        mockUseDemoMode.mockReturnValue({ isActive: true });

        render(<DemoModeBadge />);
        expect(screen.getByText('MODO DEMO')).toBeInTheDocument();
    });

    it('has correct styling when visible', () => {
        mockUseDemoMode.mockReturnValue({ isActive: true });

        render(<DemoModeBadge />);
        const badge = screen.getByText('MODO DEMO').closest('div');

        expect(badge?.className).toContain('animate-pulse');
        expect(badge?.className).toContain('bg-amber-500/20');
    });
});
