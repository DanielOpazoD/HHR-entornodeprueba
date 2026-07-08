import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PrescriptionQuickTypeButton } from '@/features/prescriptions/components/PrescriptionQuickTypeButton';

describe('PrescriptionQuickTypeButton', () => {
  it('renders the type menu as a foreground overlay outside the clipped parent', () => {
    const onChange = vi.fn(async () => undefined);
    render(
      <div data-testid="clipped-parent" className="h-10 overflow-auto">
        <PrescriptionQuickTypeButton currentType="comun" onChange={onChange} variant="inline" />
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: /común/i }));

    const menu = screen.getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    expect(menu).toHaveClass('fixed');
  });

  it('opens the type menu above the trigger when the lower viewport is clipped', () => {
    const onChange = vi.fn(async () => undefined);
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 300,
    });

    render(
      <PrescriptionQuickTypeButton currentType="comun" onChange={onChange} variant="inline" />
    );

    const trigger = screen.getByRole('button', { name: /común/i });
    vi.spyOn(trigger.parentElement as HTMLDivElement, 'getBoundingClientRect').mockReturnValue({
      bottom: 284,
      height: 24,
      left: 100,
      right: 180,
      top: 260,
      width: 80,
      x: 100,
      y: 260,
      toJSON: () => ({}),
    });

    fireEvent.click(trigger);

    const menu = screen.getByRole('menu');
    expect(Number.parseFloat(menu.style.top)).toBeLessThan(260);
  });
});
