import React, { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useDateStripWheelNavigation } from '@/components/layout/date-strip/useDateStripWheelNavigation';

const WheelHarness = ({ navigateDays }: { navigateDays: (delta: number) => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  useDateStripWheelNavigation({ containerRef, navigateDays });

  return <div ref={containerRef} data-testid="wheel-area" />;
};

describe('useDateStripWheelNavigation', () => {
  it('navigates forward on positive wheel delta', () => {
    const navigateDays = vi.fn();
    render(<WheelHarness navigateDays={navigateDays} />);

    fireEvent.wheel(screen.getByTestId('wheel-area'), { deltaY: 100 });
    expect(navigateDays).toHaveBeenCalledWith(1);
  });

  it('navigates backward on negative wheel delta', () => {
    const navigateDays = vi.fn();
    render(<WheelHarness navigateDays={navigateDays} />);

    fireEvent.wheel(screen.getByTestId('wheel-area'), { deltaY: -100 });
    expect(navigateDays).toHaveBeenCalledWith(-1);
  });
});
