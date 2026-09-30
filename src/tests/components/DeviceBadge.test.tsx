import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeviceBadge } from '@/components/device-selector/DeviceBadge';

describe('DeviceBadge layout', () => {
  it('preserves installation details without an out-of-flow tooltip extending the table', () => {
    const { container } = render(
      <DeviceBadge
        device="VVP#1"
        currentDate="2026-09-04"
        deviceDetails={{ 'VVP#1': { installationDate: '2026-09-02' } }}
      />
    );
    expect(screen.getByText('VVP')).toBeInTheDocument();
    expect(screen.getByTitle('VVP#1 · 3 días · FI: 02-09-2026')).toBeInTheDocument();
    expect(container.querySelector('.absolute')).toBeNull();
  });

  it('keeps the full device name and reports unknown age without inventing a date', () => {
    const { container } = render(<DeviceBadge device="VVP#2" />);
    expect(screen.getByText('VVP#2')).toBeInTheDocument();
    expect(screen.getByTitle('VVP#2 · antigüedad sin registrar')).toBeInTheDocument();
    expect(container.querySelector('[title]')).toHaveAttribute('tabindex', '0');
  });
});
