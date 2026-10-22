import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AuditTrailChanges } from '@/features/admin/components/internal/audit/AuditTrailChanges';

const changes = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    field: `Ítem ${index + 1}`,
    before: '1',
    after: '2',
  }));

describe('AuditTrailChanges', () => {
  it('shows up to eight changes in full', () => {
    render(<AuditTrailChanges changes={changes(8)} />);
    expect(screen.getByText(/Ítem 8/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shortens a longer list to six lines and opens the rest on request', () => {
    render(<AuditTrailChanges changes={changes(9)} />);
    expect(screen.getByText(/Ítem 6/)).toBeInTheDocument();
    expect(screen.queryByText(/Ítem 7/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '3 más' }));
    expect(screen.getByText(/Ítem 9/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'menos' }));
    expect(screen.queryByText(/Ítem 9/)).not.toBeInTheDocument();
  });
});
