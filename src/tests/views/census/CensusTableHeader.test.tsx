import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CensusTableHeader } from '@/features/census/components/CensusTableHeader';
import type { CensusTableHeaderProps } from '@/features/census/types/censusTableComponentContracts';

const actionHeaderSpy = vi.fn();
const resizableSpy = vi.fn();
const openUpcWindow = vi.hoisted(() => vi.fn());
vi.mock('@/features/census/components/patient-row/UpcClassificationWindowContext', () => ({
  useUpcClassificationWindowOpener: () => ({ openUpcWindow }),
}));

type ActionHeaderProps = {
  width: number;
  isEditMode: boolean;
  onResize: (width: number) => void;
  headerClassName: string;
};

vi.mock('@/features/census/components/CensusActionHeaderCell', () => ({
  CensusActionHeaderCell: (props: ActionHeaderProps) => {
    actionHeaderSpy(props);
    return <th data-testid="action-header-cell" />;
  },
}));

vi.mock('@/components/ui/ResizableHeader', () => ({
  ResizableHeader: ({ children }: { children: React.ReactNode }) => {
    resizableSpy(children);
    return <th>{children}</th>;
  },
}));

describe('CensusTableHeader', () => {
  const columns: CensusTableHeaderProps['columns'] = {
    actions: 50,
    bed: 80,
    type: 60,
    name: 200,
    access: 64,
    rut: 100,
    age: 50,
    diagnosis: 200,
    specialty: 80,
    status: 100,
    admission: 100,
    dmi: 60,
    scores: 56,
    cqx: 60,
    upc: 60,
  };

  it('renders action header cell and standard column labels including Diagnóstico', () => {
    render(
      <table>
        <CensusTableHeader
          readOnly={false}
          columns={columns}
          isEditMode={false}
          canDeleteRecord={true}
          resetDayDeniedMessage=""
          onClearAll={vi.fn().mockResolvedValue(undefined)}
          onResizeColumn={() => vi.fn()}
        />
      </table>
    );

    expect(screen.getByTestId('action-header-cell')).toBeInTheDocument();
    expect(actionHeaderSpy).toHaveBeenCalledTimes(1);
    expect(resizableSpy).toHaveBeenCalled();
    expect(screen.getByText('Cama')).toBeInTheDocument();
    expect(screen.getByText('Diagnóstico')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir ronda de clasificación UPC' }));
    expect(openUpcWindow).toHaveBeenCalledWith();
    expect(screen.getByText('Paciente')).toBeInTheDocument();
    // Identidad unificada: RUT y Edad ya no tienen columnas propias; C.QX está oculta.
    expect(screen.queryByText('RUT')).not.toBeInTheDocument();
    expect(screen.queryByText('Edad')).not.toBeInTheDocument();
    expect(screen.queryByText('C.QX')).not.toBeInTheDocument();
  });

  it('hides status, DMI, C.QX and UPC for specialist census access', () => {
    render(
      <table>
        <CensusTableHeader
          readOnly={true}
          columns={columns}
          isEditMode={false}
          canDeleteRecord={false}
          resetDayDeniedMessage=""
          onClearAll={vi.fn().mockResolvedValue(undefined)}
          accessProfile="specialist"
          onResizeColumn={() => vi.fn()}
        />
      </table>
    );

    expect(screen.queryByText('Estado')).not.toBeInTheDocument();
    expect(screen.queryByText('DMI')).not.toBeInTheDocument();
    expect(screen.queryByText('C.QX')).not.toBeInTheDocument();
    expect(screen.queryByText('UPC')).not.toBeInTheDocument();
    // The `admission` column is repurposed as Signos Vitales (still visible for specialists).
    expect(screen.getByText('Signos')).toBeInTheDocument();
  });
});
