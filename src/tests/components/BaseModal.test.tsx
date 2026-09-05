/**
 * BaseModal z-index Test
 * Verifies that the modal covers all application content (Navbar, DateStrip, etc.)
 *
 * Note: BaseModal uses createPortal to render in document.body, so we need to
 * query document.body instead of the render container.
 */

import { render, cleanup, fireEvent } from '@testing-library/react';
import { BaseModal } from '@/components/shared/BaseModal';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock useScrollLock to avoid DOM side effects
vi.mock('@/hooks/useScrollLock', () => ({
  useScrollLock: () => {},
  default: () => {},
}));

describe('BaseModal z-index behavior', () => {
  beforeEach(() => {
    // Clean up any portaled content before each test
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup();
  });

  it('covers the viewport above Navbar (z-50) with a blurred backdrop', () => {
    render(
      <BaseModal isOpen={true} onClose={() => {}} title="Test Modal">
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
    expect(backdrop!.className).toContain('fixed');
    expect(backdrop!.className).toContain('inset-0');
    expect(backdrop!.className).toContain('backdrop-blur');
  });

  it('keeps dialog semantics on the modal container instead of the backdrop', () => {
    render(
      <BaseModal isOpen={true} onClose={() => {}} title="Test Modal" dataModule="clinical-test">
        <div data-testid="modal-content">Content</div>
      </BaseModal>
    );

    const dialog = document.querySelector('[role="dialog"]');
    const backdrop = document.querySelector('.fixed.inset-0');

    expect(dialog).toBeTruthy();
    expect(backdrop).toBeTruthy();
    expect(dialog).not.toBe(backdrop);
    expect(dialog).toHaveAttribute('data-module', 'clinical-test');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title');
    expect(backdrop).not.toHaveAttribute('role');
  });

  it('should not render when isOpen is false', () => {
    render(
      <BaseModal isOpen={false} onClose={() => {}} title="Test Modal">
        <div data-testid="modal-content">Content</div>
      </BaseModal>
    );

    // No portal should be created
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeNull();
  });

  it('uses an opaque light clinical surface by default', () => {
    render(
      <BaseModal isOpen={true} onClose={() => {}} title="Test Modal">
        <div>Content</div>
      </BaseModal>
    );

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toHaveClass('bg-white', 'border-slate-200');
    expect(dialog).not.toHaveClass('glass');
  });

  it('should use viewport scrolling instead of internal body scrolling when scrollableBody is false', () => {
    render(
      <BaseModal isOpen={true} onClose={() => {}} title="Test Modal" scrollableBody={false}>
        <div data-testid="modal-content">Content</div>
      </BaseModal>
    );

    const backdrop = document.querySelector('.fixed.inset-0');
    expect(backdrop).toBeTruthy();
    expect(backdrop!.className).toContain('overflow-y-auto');

    const body = document.querySelector('[role="dialog"] .overflow-visible');
    expect(body).toBeTruthy();
  });

  it('closes on backdrop click but not on inner content click', () => {
    const onClose = vi.fn();

    render(
      <BaseModal isOpen={true} onClose={onClose} title="Test Modal">
        <button type="button">Inner action</button>
      </BaseModal>
    );

    const backdrop = document.querySelector('.fixed.inset-0');
    const innerButton = document.querySelector('button[type="button"]');
    expect(backdrop).toBeTruthy();
    expect(innerButton).toBeTruthy();

    fireEvent.click(innerButton!);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not leak inner modal pointer events to document listeners', () => {
    const documentClick = vi.fn();
    const documentMouseDown = vi.fn();
    document.addEventListener('click', documentClick);
    document.addEventListener('mousedown', documentMouseDown);

    render(
      <BaseModal isOpen={true} onClose={() => {}} title="Test Modal">
        <button type="button">Inner action</button>
      </BaseModal>
    );

    const innerButton = document.querySelector('button[type="button"]');
    expect(innerButton).toBeTruthy();

    fireEvent.mouseDown(innerButton!);
    fireEvent.click(innerButton!);

    expect(documentMouseDown).not.toHaveBeenCalled();
    expect(documentClick).not.toHaveBeenCalled();

    document.removeEventListener('click', documentClick);
    document.removeEventListener('mousedown', documentMouseDown);
  });

  it('focuses the dialog container when there is no focusable body control', () => {
    vi.useFakeTimers();

    render(
      <BaseModal isOpen={true} onClose={() => {}} title="Test Modal" showCloseButton={false}>
        <p>Static clinical content</p>
      </BaseModal>
    );

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();

    vi.advanceTimersByTime(100);

    expect(document.activeElement).toBe(dialog);
    vi.useRealTimers();
  });
});
