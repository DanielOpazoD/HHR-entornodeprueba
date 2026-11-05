import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CensusActionHeaderCell } from '@/features/census/components/CensusActionHeaderCell';
import { ClinicalExplorerLaunchContext } from '@/features/census/components/clinical-explorer/clinicalExplorerLaunch';

vi.mock('@/components/ui/ResizableHeader', () => ({
  ResizableHeader: ({ children, className }: { children: ReactNode; className?: string }) => (
    <th className={className}>{children}</th>
  ),
}));

const renderCorner = (launch: (() => void) | null) =>
  render(
    <ClinicalExplorerLaunchContext.Provider value={launch}>
      <table>
        <thead>
          <tr>
            <CensusActionHeaderCell
              width={50}
              isEditMode={false}
              onResize={vi.fn()}
              headerClassName="header"
            />
          </tr>
        </thead>
      </table>
    </ClinicalExplorerLaunchContext.Provider>
  );

describe('CensusActionHeaderCell', () => {
  it('opens the clinical explorer from the table corner', () => {
    const launch = vi.fn();
    renderCorner(launch);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir explorador clínico' }));
    expect(launch).toHaveBeenCalledTimes(1);
    // Clearing the day moved to the «⋯» menu: the corner never offers it.
    expect(screen.queryByTitle(/Limpiar|Eliminar/)).toBeNull();
  });

  it('says why the explorer cannot open when no patient has RUT and episode', () => {
    renderCorner(null);
    const button = screen.getByRole('button', { name: 'Abrir explorador clínico' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Sin pacientes con RUT y episodio en este censo');
  });
});
