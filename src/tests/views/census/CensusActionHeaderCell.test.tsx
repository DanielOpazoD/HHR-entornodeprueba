import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CensusActionHeaderCell } from '@/features/census/components/CensusActionHeaderCell';

vi.mock('@/components/ui/ResizableHeader', () => ({
  ResizableHeader: ({ children, className }: { children: ReactNode; className?: string }) => (
    <th className={className}>{children}</th>
  ),
}));

describe('CensusActionHeaderCell', () => {
  it('renders clear-day button when delete is allowed', () => {
    render(
      <table>
        <thead>
          <tr>
            <CensusActionHeaderCell
              width={50}
              isEditMode={false}
              onResize={vi.fn()}
              headerClassName="header"
              readOnly={false}
              canDeleteRecord={true}
              deniedMessage="No autorizado"
              onClearAll={vi.fn()}
            />
          </tr>
        </thead>
      </table>
    );

    expect(screen.getByTitle('Limpiar todos los datos del día')).toBeInTheDocument();
  });

  it('invokes clear callback when button is clicked', () => {
    const onClearAll = vi.fn().mockResolvedValue(undefined);

    render(
      <table>
        <thead>
          <tr>
            <CensusActionHeaderCell
              width={50}
              isEditMode={false}
              onResize={vi.fn()}
              headerClassName="header"
              readOnly={false}
              canDeleteRecord={true}
              deniedMessage="No autorizado"
              onClearAll={onClearAll}
            />
          </tr>
        </thead>
      </table>
    );

    fireEvent.click(screen.getByTitle('Limpiar todos los datos del día'));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('hides button in readonly mode when delete is denied', () => {
    render(
      <table>
        <thead>
          <tr>
            <CensusActionHeaderCell
              width={50}
              isEditMode={false}
              onResize={vi.fn()}
              headerClassName="header"
              readOnly={true}
              canDeleteRecord={false}
              deniedMessage="No autorizado"
              onClearAll={vi.fn()}
            />
          </tr>
        </thead>
      </table>
    );

    expect(screen.queryByTitle('No autorizado')).not.toBeInTheDocument();
  });
});
