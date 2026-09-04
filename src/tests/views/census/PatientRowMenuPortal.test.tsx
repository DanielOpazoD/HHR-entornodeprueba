import React, { createRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PatientRowMenuPortal } from '@/features/census/components/patient-row/PatientRowMenuPortal';

describe('PatientRowMenuPortal', () => {
  it('escapes table overflow, preserves inside clicks and closes on outside click, Escape and scroll', () => {
    const anchorRef = createRef<HTMLDivElement>();
    const onClose = vi.fn();
    const onAction = vi.fn();
    const { container } = render(
      <div style={{ overflowX: 'auto' }}>
        <div ref={anchorRef}>Anchor</div>
        <PatientRowMenuPortal anchorRef={anchorRef} align="top" onClose={onClose}>
          <button onClick={onAction}>Action</button>
        </PatientRowMenuPortal>
      </div>
    );
    const panel = screen.getByTestId('patient-row-menu-portal');
    expect(panel.parentElement).toBe(document.body);
    expect(container.contains(panel)).toBe(false);
    fireEvent.mouseDown(screen.getByText('Action'));
    fireEvent.click(screen.getByText('Action'));
    fireEvent.mouseDown(anchorRef.current!);
    fireEvent.scroll(panel);
    expect(onAction).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.scroll(container);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it.each(['top', 'bottom'] as const)(
    'keeps the %s-aligned menu inside the viewport',
    async align => {
      const anchor = document.createElement('div');
      anchor.getBoundingClientRect = () =>
        ({
          top: 9999,
          bottom: 10020,
          right: 9999,
        }) as DOMRect;
      render(
        <PatientRowMenuPortal anchorRef={{ current: anchor }} align={align} onClose={vi.fn()}>
          Menu
        </PatientRowMenuPortal>
      );
      await waitFor(() => {
        const panel = screen.getByTestId('patient-row-menu-portal');
        expect(parseFloat(panel.style.left)).toBeLessThan(window.innerWidth);
        expect(parseFloat(panel.style.top)).toBeLessThan(window.innerHeight);
        expect(parseFloat(panel.style.left)).toBeGreaterThanOrEqual(8);
        expect(parseFloat(panel.style.top)).toBeGreaterThanOrEqual(8);
      });
    }
  );
});
