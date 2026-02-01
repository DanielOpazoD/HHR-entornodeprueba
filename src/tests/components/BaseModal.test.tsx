/**
 * BaseModal z-index Test
 * Verifies that the modal covers all application content (Navbar, DateStrip, etc.)
 * 
 * Note: BaseModal uses createPortal to render in document.body, so we need to
 * query document.body instead of the render container.
 */

import { render, cleanup } from '@testing-library/react';
import { BaseModal } from '@/components/shared/BaseModal';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock useScrollLock to avoid DOM side effects
vi.mock('../../hooks/useScrollLock', () => ({
    useScrollLock: () => { },
    default: () => { }
}));

describe('BaseModal z-index behavior', () => {
    beforeEach(() => {
        // Clean up any portaled content before each test
        document.body.innerHTML = '';
    });

    afterEach(() => {
        cleanup();
    });

    it('should have a z-index higher than Navbar (z-50)', () => {
        render(
            <BaseModal isOpen={true} onClose={() => { }} title="Test Modal">
                <div data-testid="modal-content">Content</div>
            </BaseModal>
        );

        // Since we use createPortal, the modal is rendered in document.body
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog).toBeTruthy();

        // The dialog is the inner container, its parent is the backdrop
        const backdrop = dialog!.closest('.fixed.inset-0');
        expect(backdrop).toBeTruthy();
        expect(backdrop!.className).toContain('z-[100]');
    });

    it('should render with fixed positioning and cover the entire viewport', () => {
        render(
            <BaseModal isOpen={true} onClose={() => { }} title="Test Modal">
                <div data-testid="modal-content">Content</div>
            </BaseModal>
        );

        const backdrop = document.querySelector('.fixed.inset-0');
        expect(backdrop).toBeTruthy();
        expect(backdrop!.className).toContain('fixed');
        expect(backdrop!.className).toContain('inset-0');
    });

    it('should not render when isOpen is false', () => {
        render(
            <BaseModal isOpen={false} onClose={() => { }} title="Test Modal">
                <div data-testid="modal-content">Content</div>
            </BaseModal>
        );

        // No portal should be created
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog).toBeNull();
    });

    it('should have backdrop blur effect', () => {
        render(
            <BaseModal isOpen={true} onClose={() => { }} title="Test Modal">
                <div data-testid="modal-content">Content</div>
            </BaseModal>
        );

        const backdrop = document.querySelector('.fixed.inset-0');
        expect(backdrop!.className).toContain('backdrop-blur');
    });
});
