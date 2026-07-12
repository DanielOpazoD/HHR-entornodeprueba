import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CensusTableHeader } from '@/features/census/components/CensusTableHeader';
import type { CensusTableHeaderProps } from '@/features/census/types/censusTableComponentContracts';
import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';

const diagnosisHeaderSpy = vi.fn();
const actionHeaderSpy = vi.fn();
const resizableSpy = vi.fn();

type ActionHeaderProps = {
  width: number;
  isEditMode: boolean;
  onResize: (width: number) => void;
  headerClassName: string;
  readOnly: boolean;
  canDeleteRecord: boolean;
  deniedMessage: string;
  onClearAll: () => Promise<void>;
};

type DiagnosisHeaderProps = {
  width: number;
  isEditMode: boolean;
  onResize: (width: number) => void;
  headerClassName: string;
  readOnly: boolean;
  diagnosisMode: DiagnosisMode;
  onToggleDiagnosisMode: () => void;
};

vi.mock('@/features/census/components/CensusActionHeaderCell', () => ({
  CensusActionHeaderCell: (props: ActionHeaderProps) => {
    actionHeaderSpy(props);
    return <th data-testid="action-header-cell" />;
  },
}));

vi.mock('@/features/census/components/CensusDiagnosisHeaderCell', () => ({
  CensusDiagnosisHeaderCell: (props: DiagnosisHeaderProps) => {
    diagnosisHeaderSpy(props);
    return <th data-testid="diagnosis-header-cell" />;
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

  it('renders action and diagnosis header cells and standard labels', () => {
    render(
      <table>
        <CensusTableHeader
          readOnly={false}
          columns={columns}
          isEditMode={false}
          canDeleteRecord={true}
          resetDayDeniedMessage=""
          onClearAll={vi.fn().mockResolvedValue(undefined)}
          diagnosisMode="free"
          onToggleDiagnosisMode={vi.fn()}
          onResizeColumn={() => vi.fn()}
        />
      </table>
    );

    expect(screen.getByTestId('action-header-cell')).toBeInTheDocument();
    expect(screen.getByTestId('diagnosis-header-cell')).toBeInTheDocument();
    expect(diagnosisHeaderSpy).toHaveBeenCalledTimes(1);
    expect(actionHeaderSpy).toHaveBeenCalledTimes(1);
    expect(resizableSpy).toHaveBeenCalled();
    expect(screen.getByText('Cama')).toBeInTheDocument();
    expect(screen.getByText('UPC')).toBeInTheDocument();
    expect(screen.getByText('Paciente')).toBeInTheDocument();
    // Identidad unificada: RUT y Edad ya no tienen columnas propias; C.QX está oculta.
    expect(screen.queryByText('RUT')).not.toBeInTheDocument();
    expect(screen.queryByText('Edad')).not.toBeInTheDocument();
    expect(screen.queryByText('C.QX')).not.toBeInTheDocument();
  });

  it('forwards diagnosis mode to diagnosis header cell', () => {
    render(
      <table>
        <CensusTableHeader
          readOnly={true}
          columns={columns}
          isEditMode={false}
          canDeleteRecord={false}
          resetDayDeniedMessage="No autorizado"
          onClearAll={vi.fn().mockResolvedValue(undefined)}
          diagnosisMode="cie10"
          onToggleDiagnosisMode={vi.fn()}
          onResizeColumn={() => vi.fn()}
        />
      </table>
    );

    expect(diagnosisHeaderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnosisMode: 'cie10',
        readOnly: true,
      })
    );
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
          diagnosisMode="free"
          accessProfile="specialist"
          onToggleDiagnosisMode={vi.fn()}
          onResizeColumn={() => vi.fn()}
        />
      </table>
    );

    expect(screen.queryByText('Estado')).not.toBeInTheDocument();
    expect(screen.queryByText('DMI')).not.toBeInTheDocument();
    expect(screen.queryByText('C.QX')).not.toBeInTheDocument();
    expect(screen.queryByText('UPC')).not.toBeInTheDocument();
    expect(screen.getByText('Ingreso')).toBeInTheDocument();
  });
});
