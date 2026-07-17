import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, render, fireEvent, within } from '@testing-library/react';
import React from 'react';

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    notify: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  }),
}));

import { CudyrView } from '@/features/cudyr/components/CudyrView';
import { DataFactory } from '../../factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';

// Mock the useCudyrLogic hook directly
const mockUseCudyrLogic = vi.fn();

vi.mock('@/features/cudyr/hooks/useCudyrLogic', () => ({
  useCudyrLogic: () => mockUseCudyrLogic(),
}));

const emptyCategoryCounts = {
  A1: 0,
  A2: 0,
  A3: 0,
  B1: 0,
  B2: 0,
  B3: 0,
  C1: 0,
  C2: 0,
  C3: 0,
  D1: 0,
  D2: 0,
  D3: 0,
};

const createMockCudyrLogicReturn = (record: DailyRecord | null, overrides = {}) => ({
  record,
  visibleBeds: record
    ? [
        { id: 'R1', name: 'R1', type: 'UTI', isCuna: false },
        { id: 'R2', name: 'R2', type: 'UTI', isCuna: false },
      ]
    : [],
  stats: { total: 2, occupiedCount: 0, categorizedCount: 0 },
  cudyrSummary: {
    counts: {
      uti: { ...emptyCategoryCounts },
      media: { ...emptyCategoryCounts },
    },
    utiTotal: 0,
    mediaTotal: 0,
    totalDep: 0,
    totalRisk: 0,
    avgDep: 0,
    avgRisk: 0,
  },
  isEditingLocked: false,
  isCompletionLocked: false,
  persistedCompletion: { eligibleCount: 0, completedCount: 0, isComplete: false },
  pendingCudyrChangeCount: 0,
  isSavingCudyrChanges: false,
  handleScoreChange: vi.fn(),
  handleCribScoreChange: vi.fn(),
  saveCudyrChanges: vi.fn(),
  discardCudyrChanges: vi.fn(),
  resolveCudyrEligibility: vi.fn().mockReturnValue({
    isEligible: true,
    isBlocked: false,
    blockedReason: undefined,
  }),
  ...overrides,
});

describe('CudyrView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty message when no record is selected', () => {
    mockUseCudyrLogic.mockReturnValue(createMockCudyrLogicReturn(null));

    render(<CudyrView />);
    expect(screen.getByText(/Seleccione una fecha con registros/i)).toBeInTheDocument();
  });

  it('renders patient rows correctly', () => {
    const record = DataFactory.createMockDailyRecord('2024-12-11');
    record.beds['R1'] = DataFactory.createMockPatient('R1', {
      patientName: 'JUAN TEST',
      rut: '1-1',
    });

    mockUseCudyrLogic.mockReturnValue(
      createMockCudyrLogicReturn(record, {
        stats: { total: 2, occupiedCount: 1, categorizedCount: 0 },
      })
    );

    render(<CudyrView />);

    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('JUAN TEST')).toBeInTheDocument();
  });

  it('shows official CUDYR professional and registration time in the imported tooltip', () => {
    const record = DataFactory.createMockDailyRecord('2026-07-16');
    record.beds['R1'] = DataFactory.createMockPatient('R1', {
      patientName: 'PACIENTE IMPORTADO',
      evaluationScores: {
        cudyr: {
          category: 'C2',
          recordedDate: '2026-07-16',
          recordedAt: '2026-07-17T07:00:00.000Z',
          author: 'Constanza Guajardo',
          authorRole: 'Enfermería',
          source: 'Eloísa · Gestión de Camas',
          items: [],
        },
      },
    });
    mockUseCudyrLogic.mockReturnValue(createMockCudyrLogicReturn(record));

    render(<CudyrView />);

    const provenance = screen.getByText('Importado Eloísa ⓘ');
    expect(provenance).toHaveAttribute('title', expect.stringContaining('Constanza Guajardo'));
    expect(provenance).toHaveAttribute('title', expect.stringContaining('Registrado:'));
  });

  it('calculates occupied and categorized counts correctly', () => {
    const record = DataFactory.createMockDailyRecord('2024-12-11');
    record.beds['R1'] = DataFactory.createMockPatient('R1', {
      patientName: 'PACIENTE 1',
      cudyr: {
        changeClothes: 1,
        mobilization: 1,
        feeding: 1,
        elimination: 1,
        psychosocial: 1,
        surveillance: 1,
        vitalSigns: 1,
        fluidBalance: 1,
        oxygenTherapy: 1,
        airway: 1,
        proInterventions: 1,
        skinCare: 1,
        pharmacology: 1,
        invasiveElements: 1,
      },
    });
    record.beds['R2'] = DataFactory.createMockPatient('R2', {
      patientName: 'PACIENTE 2',
    });

    mockUseCudyrLogic.mockReturnValue(
      createMockCudyrLogicReturn(record, {
        stats: { total: 2, occupiedCount: 2, categorizedCount: 1 },
      })
    );

    render(<CudyrView />);

    expect(screen.getAllByText(/Ocupadas/i).at(-1)?.parentElement).toHaveTextContent(/2/);
    expect(screen.getAllByText(/Categorizadas/i).at(-1)?.parentElement).toHaveTextContent(/1/);
  });

  it('updates CUDYR field when a radio button is clicked', () => {
    const record = DataFactory.createMockDailyRecord('2024-12-11');
    record.beds['R1'] = DataFactory.createMockPatient('R1', {
      patientName: 'JUAN TEST',
    });

    const mockHandleScoreChange = vi.fn();
    mockUseCudyrLogic.mockReturnValue(
      createMockCudyrLogicReturn(record, {
        handleScoreChange: mockHandleScoreChange,
        stats: { total: 1, occupiedCount: 1, categorizedCount: 0 },
      })
    );

    render(<CudyrView />);

    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '1' } });

    expect(mockHandleScoreChange).toHaveBeenCalled();
  });

  it('shows manual CUDYR save controls when there are pending cell changes', () => {
    const record = DataFactory.createMockDailyRecord('2024-12-11');
    record.beds['R1'] = DataFactory.createMockPatient('R1', {
      patientName: 'JUAN TEST',
    });
    const saveCudyrChanges = vi.fn();
    const discardCudyrChanges = vi.fn();

    mockUseCudyrLogic.mockReturnValue(
      createMockCudyrLogicReturn(record, {
        pendingCudyrChangeCount: 2,
        saveCudyrChanges,
        discardCudyrChanges,
        stats: { total: 1, occupiedCount: 1, categorizedCount: 0 },
      })
    );

    render(<CudyrView />);

    const pendingRow = screen.getByTestId('cudyr-pending-save-row');
    expect(pendingRow).toHaveTextContent(/2 cambios pendientes/i);
    expect(pendingRow.parentElement?.tagName).toBe('TBODY');
    expect(pendingRow.parentElement?.firstElementChild).toBe(pendingRow);
    expect(pendingRow.compareDocumentPosition(screen.getByText('R1').closest('tr')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(
      screen
        .getByText(/Cuidados Cambio Ropa/i)
        .closest('tr')
        ?.compareDocumentPosition(pendingRow)
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    expect(screen.getByRole('button', { name: /descartar/i })).toHaveClass(
      'px-3.5',
      'py-1.5',
      'text-[13px]'
    );
    expect(screen.getByRole('button', { name: /guardar cudyr/i })).toHaveClass(
      'px-4',
      'py-1.5',
      'text-[13px]'
    );

    fireEvent.click(screen.getByRole('button', { name: /guardar cudyr/i }));
    expect(saveCudyrChanges).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /descartar/i }));
    expect(discardCudyrChanges).toHaveBeenCalledTimes(1);
  });

  it('shows explicit CUDYR saving feedback while the batch is being persisted', () => {
    const record = DataFactory.createMockDailyRecord('2024-12-11');
    record.beds['R1'] = DataFactory.createMockPatient('R1', {
      patientName: 'JUAN TEST',
    });

    mockUseCudyrLogic.mockReturnValue(
      createMockCudyrLogicReturn(record, {
        pendingCudyrChangeCount: 2,
        isSavingCudyrChanges: true,
        stats: { total: 1, occupiedCount: 1, categorizedCount: 0 },
      })
    );

    render(<CudyrView />);

    expect(screen.getByRole('button', { name: /guardando/i })).toBeDisabled();
  });

  it('renders and manages clinical cribs in CUDYR table', () => {
    const record = DataFactory.createMockDailyRecord('2024-12-11');
    record.beds['R1'] = DataFactory.createMockPatient('R1', {
      patientName: 'MADRE',
      clinicalCrib: DataFactory.createMockPatient('R1-C', {
        patientName: 'BEBE',
        cudyr: {
          changeClothes: 2,
          mobilization: 0,
          feeding: 0,
          elimination: 0,
          psychosocial: 0,
          surveillance: 0,
          vitalSigns: 0,
          fluidBalance: 0,
          oxygenTherapy: 0,
          airway: 0,
          proInterventions: 0,
          skinCare: 0,
          pharmacology: 0,
          invasiveElements: 0,
        },
      }),
    });

    mockUseCudyrLogic.mockReturnValue(
      createMockCudyrLogicReturn(record, {
        stats: { total: 2, occupiedCount: 2, categorizedCount: 1 },
      })
    );

    render(<CudyrView />);

    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('R1 (CC)')).toBeInTheDocument();

    expect(screen.getAllByText(/Ocupadas/i).at(-1)?.parentElement).toHaveTextContent(/2/);
    expect(screen.getAllByText(/Categorizadas/i).at(-1)?.parentElement).toHaveTextContent(/1/);
  });

  it('shows blocked CUDYR rows instead of hiding patients excluded by the night-shift rule', () => {
    const record = DataFactory.createMockDailyRecord('2024-12-11');
    record.beds['R1'] = DataFactory.createMockPatient('R1', {
      patientName: 'PACIENTE BLOQUEADO',
      admissionDate: '2024-12-11',
      admissionTime: '23:30',
      cudyr: {
        changeClothes: 3,
        mobilization: 3,
        feeding: 3,
        elimination: 3,
        psychosocial: 3,
        surveillance: 3,
        vitalSigns: 3,
        fluidBalance: 3,
        oxygenTherapy: 3,
        airway: 3,
        proInterventions: 3,
        skinCare: 3,
        pharmacology: 3,
        invasiveElements: 3,
      },
    });

    mockUseCudyrLogic.mockReturnValue(
      createMockCudyrLogicReturn(record, {
        stats: { total: 1, occupiedCount: 0, categorizedCount: 0 },
        resolveCudyrEligibility: vi.fn().mockReturnValue({
          isEligible: false,
          isBlocked: true,
          blockedReason: 'Ingreso menor a 8 h al corte fijo 01:00.',
        }),
      })
    );

    render(<CudyrView />);

    const blockedRow = screen.getByText('PACIENTE BLOQUEADO').closest('tr');
    expect(screen.getByText('PACIENTE BLOQUEADO')).toBeInTheDocument();
    expect(screen.getByText(/Bloqueado CUDYR/i)).toBeInTheDocument();
    expect(blockedRow).not.toBeNull();
    expect(within(blockedRow as HTMLTableRowElement).queryByText(/^A1$/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('spinbutton').every(input => input.hasAttribute('disabled'))).toBe(
      true
    );
    expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value).toBe('');
  });

  it('leaves the table read-only when the record is outside the editable window', () => {
    const record = DataFactory.createMockDailyRecord('2024-12-09');
    record.beds['R1'] = DataFactory.createMockPatient('R1', {
      patientName: 'PACIENTE ANTIGUO',
    });

    mockUseCudyrLogic.mockReturnValue(
      createMockCudyrLogicReturn(record, {
        isEditingLocked: true,
        stats: { total: 1, occupiedCount: 1, categorizedCount: 0 },
      })
    );

    render(<CudyrView />);

    expect(screen.getAllByRole('spinbutton').every(input => input.hasAttribute('disabled'))).toBe(
      true
    );
  });

  it('shows the synchronized completion owner and keeps the completed sheet read-only', () => {
    const record = DataFactory.createMockDailyRecord('2026-07-16', {
      cudyrUpdatedAt: '2026-07-17T01:05:00.000Z',
      cudyrUpdatedBy: 'Enfermera Noche',
      cudyrCompletedAt: '2026-07-17T01:05:00.000Z',
      cudyrCompletedBy: 'Enfermera Noche',
      cudyrLocked: true,
    });
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'PACIENTE COMPLETO',
      cudyr: DataFactory.createMockCudyr({ changeClothes: 1 }),
    });
    mockUseCudyrLogic.mockReturnValue(
      createMockCudyrLogicReturn(record, {
        isEditingLocked: true,
        isCompletionLocked: true,
        persistedCompletion: { eligibleCount: 1, completedCount: 1, isComplete: true },
        stats: { total: 1, occupiedCount: 1, categorizedCount: 1 },
      })
    );

    render(<CudyrView />);

    expect(screen.getByTestId('cudyr-completion-lock-notice')).toHaveTextContent(
      /turno noche 2026-07-16/i
    );
    expect(screen.getByText(/Completado por Enfermera Noche/i)).toBeInTheDocument();
    expect(screen.getAllByRole('spinbutton').every(input => input.hasAttribute('disabled'))).toBe(
      true
    );
  });

  it('shows the legacy notice when an older completed record has no atomic attribution', () => {
    const record = DataFactory.createMockDailyRecord('2026-07-16', {
      cudyrLocked: true,
      cudyrLockedAt: '2026-07-17T01:05:00.000Z',
      cudyrLockedBy: 'usuario-enfermeria-legado',
    });
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'PACIENTE LEGADO COMPLETO',
      cudyr: DataFactory.createMockCudyr(),
    });
    mockUseCudyrLogic.mockReturnValue(
      createMockCudyrLogicReturn(record, {
        isEditingLocked: true,
        isCompletionLocked: true,
        persistedCompletion: { eligibleCount: 1, completedCount: 1, isComplete: true },
      })
    );

    render(<CudyrView />);

    expect(screen.getByTestId('cudyr-legacy-lock-notice')).toHaveTextContent(
      /completo sin cierre atribuido/i
    );
    expect(screen.queryByText(/Completado por/i)).not.toBeInTheDocument();
  });

  it('labels an incomplete legacy manual lock without claiming synchronized completion', () => {
    const record = DataFactory.createMockDailyRecord('2026-07-16', {
      cudyrLocked: true,
      cudyrLockedAt: '2026-07-17T01:05:00.000Z',
      cudyrLockedBy: 'usuario-legado',
    });
    mockUseCudyrLogic.mockReturnValue(
      createMockCudyrLogicReturn(record, {
        isEditingLocked: true,
        isCompletionLocked: true,
        persistedCompletion: { eligibleCount: 2, completedCount: 1, isComplete: false },
      })
    );

    render(<CudyrView />);

    expect(screen.getByTestId('cudyr-legacy-lock-notice')).toHaveTextContent(/1 de 2/i);
    expect(screen.queryByTestId('cudyr-completion-lock-notice')).not.toBeInTheDocument();
    expect(screen.queryByText(/Completado por/i)).not.toBeInTheDocument();
  });
});
