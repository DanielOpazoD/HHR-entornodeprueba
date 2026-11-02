import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import NursingPasswordDialog from '@/components/layout/NursingPasswordDialog';

describe('NursingPasswordDialog', () => {
  it('opens over the whole page, outside the navbar that would cut it off', () => {
    render(
      <nav style={{ transform: 'translateZ(0)' }} data-testid="navbar">
        <NursingPasswordDialog onClose={vi.fn()} />
      </nav>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.parentElement).toBe(document.body);
    expect(screen.getByTestId('navbar')).not.toContainElement(dialog);
  });
});
