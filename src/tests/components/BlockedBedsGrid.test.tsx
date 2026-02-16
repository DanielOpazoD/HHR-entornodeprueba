import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlockedBedsGrid } from '@/components/modals/BlockedBedsGrid';

describe('BlockedBedsGrid', () => {
  it('calls onBedClick with selected bed payload', () => {
    const onBedClick = vi.fn();
    render(
      <BlockedBedsGrid
        beds={[
          { id: 'R1', name: 'R1', isBlocked: true, blockedReason: 'Mantención' },
          { id: 'R2', name: 'R2', isBlocked: false },
        ]}
        disabled={false}
        onBedClick={onBedClick}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Gestionar cama R1: Bloqueada' }));
    expect(onBedClick).toHaveBeenCalledWith({
      id: 'R1',
      name: 'R1',
      isBlocked: true,
      blockedReason: 'Mantención',
    });
  });

  it('respects disabled state', () => {
    const onBedClick = vi.fn();
    render(
      <BlockedBedsGrid
        beds={[{ id: 'R3', name: 'R3', isBlocked: false }]}
        disabled={true}
        onBedClick={onBedClick}
      />
    );

    const button = screen.getByRole('button', { name: 'Gestionar cama R3: Disponible' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onBedClick).not.toHaveBeenCalled();
  });
});
