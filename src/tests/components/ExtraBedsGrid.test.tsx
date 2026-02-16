import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExtraBedsGrid } from '@/components/modals/ExtraBedsGrid';

describe('ExtraBedsGrid', () => {
  it('calls onToggleBed with bed id and keeps aria-pressed state', () => {
    const onToggleBed = vi.fn();
    render(
      <ExtraBedsGrid
        beds={[
          { id: 'E1', name: 'E1', isEnabled: true },
          { id: 'E2', name: 'E2', isEnabled: false },
        ]}
        disabled={false}
        onToggleBed={onToggleBed}
      />
    );

    const enabled = screen.getByRole('button', { name: 'Desactivar cama extra E1' });
    const disabled = screen.getByRole('button', { name: 'Activar cama extra E2' });

    expect(enabled).toHaveAttribute('aria-pressed', 'true');
    expect(disabled).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(disabled);
    expect(onToggleBed).toHaveBeenCalledWith('E2');
  });

  it('respects disabled state', () => {
    const onToggleBed = vi.fn();
    render(
      <ExtraBedsGrid
        beds={[{ id: 'E3', name: 'E3', isEnabled: false }]}
        disabled={true}
        onToggleBed={onToggleBed}
      />
    );

    const button = screen.getByRole('button', { name: 'Activar cama extra E3' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onToggleBed).not.toHaveBeenCalled();
  });
});
