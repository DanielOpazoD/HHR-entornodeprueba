import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TensSelector } from '@/features/census/components/TensSelector';
import { VACANCY_LABEL } from '@/services/staff/staffSelectionPresentation';

const setShowTensManager = vi.fn();

vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({
    setShowTensManager,
    staffUsage: { nurse: {}, tens: { 'ana habitual': 3 } },
    staffIdentities: [
      {
        key: 'tens:id:a',
        role: 'tens',
        name: 'Ana Maria Soto Rojas',
        aliases: ['Ana Maria Soto Rojas', 'Ana Soto'],
      },
    ],
  }),
}));

describe('TensSelector', () => {
  it('reveals less-used TENS without saving a shift merely by expanding the list', () => {
    const update = vi.fn();
    render(
      <TensSelector
        tensDayShift={['Ana Habitual', '', '']}
        tensNightShift={['', '', '']}
        tensList={['Ana Habitual', 'Berta Poco', 'Carla Poco', 'Dora Poco']}
        onUpdateTens={update}
      />
    );
    expect(screen.queryByRole('option', { name: 'Berta Poco' })).not.toBeInTheDocument();
    const more = screen.getByRole('button', {
      name: 'Mostrar nombres menos usados de TENS · turno largo · puesto 1',
    });
    expect(more).toHaveTextContent('');
    fireEvent.click(more);
    expect(screen.getAllByRole('option', { name: 'Berta Poco' })).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
  });
  it('shows a short label but saves the canonical TENS name', () => {
    const update = vi.fn();
    render(
      <TensSelector
        tensDayShift={['Ana Soto', '', '']}
        tensNightShift={['', '', '']}
        tensList={['Ana Maria Soto Rojas']}
        onUpdateTens={update}
      />
    );
    expect(screen.getAllByRole('option', { name: 'Ana Soto' })).toHaveLength(6);
    expect(screen.getByLabelText('TENS · turno largo · puesto 1')).toHaveValue(
      'Ana Maria Soto Rojas'
    );
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('TENS · turno largo · puesto 1'), {
      target: { value: 'Ana Maria Soto Rojas' },
    });
    expect(update).toHaveBeenCalledWith('day', 0, 'Ana Maria Soto Rojas');
  });
  it('keeps selected staff visible even when the catalog has not hydrated yet', () => {
    render(
      <TensSelector
        tensDayShift={['Tens Paula', '', '']}
        tensNightShift={['', '', '']}
        tensList={[]}
        onUpdateTens={vi.fn()}
      />
    );

    expect(screen.getAllByRole('option', { name: 'Tens Paula' }).length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue('Tens Paula')).toHaveLength(1);
  });

  it('opens the catalog from the title area and uses a superscript marker only when needed', () => {
    const onOpenDetailedStaffing = vi.fn();

    render(
      <TensSelector
        tensDayShift={['Tens Paula', '', '']}
        tensNightShift={['', '', '']}
        tensList={[]}
        onUpdateTens={vi.fn()}
        shiftIndicators={{
          day: { hasSpecialSchedule: false, extraCount: 1 },
          night: { hasSpecialSchedule: false, extraCount: 0 },
        }}
        onOpenDetailedStaffing={onOpenDetailedStaffing}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir catálogo de TENS' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir configuración detallada de TENS' }));

    expect(setShowTensManager).toHaveBeenCalledWith(true);
    expect(onOpenDetailedStaffing).toHaveBeenCalledTimes(1);
    expect(screen.getByText('*')).toBeInTheDocument();
    expect(screen.queryByText('+1')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Configurar detalle de TENS turno Largo')
    ).not.toBeInTheDocument();
  });

  it('renders vacancy selections with a muted disabled-like appearance', () => {
    render(
      <TensSelector
        tensDayShift={[VACANCY_LABEL, '', '']}
        tensNightShift={['', '', '']}
        tensList={['Tens Paula']}
        onUpdateTens={vi.fn()}
      />
    );

    const vacancySelect = screen.getAllByDisplayValue(VACANCY_LABEL)[0];

    expect(vacancySelect).toHaveClass(
      'rounded-md',
      'bg-slate-150',
      'text-slate-600',
      'border-slate-300'
    );
  });
});
