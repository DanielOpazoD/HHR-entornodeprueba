import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NurseSelector } from '@/features/census/components/NurseSelector';
import { VACANCY_LABEL } from '@/services/staff/staffSelectionPresentation';

const setShowNurseManager = vi.fn();

vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({
    setShowNurseManager,
    staffUsage: { nurse: { 'ana habitual': 3 }, tens: {} },
    staffIdentities: [
      {
        key: 'nurse:id:a',
        role: 'nurse',
        name: 'Ana Maria Soto Rojas',
        aliases: ['Ana Maria Soto Rojas', 'Ana Soto'],
      },
    ],
  }),
}));

describe('NurseSelector', () => {
  it('reveals less-used nurses on demand without changing the selected assignment', () => {
    const update = vi.fn();
    render(
      <NurseSelector
        nursesDayShift={['Ana Habitual', '']}
        nursesNightShift={['', '']}
        nursesList={['Ana Habitual', 'Berta Poco', 'Carla Poco', 'Dora Poco']}
        onUpdateNurse={update}
      />
    );
    expect(screen.queryByRole('option', { name: 'Berta Poco' })).not.toBeInTheDocument();
    const more = screen.getByRole('button', {
      name: 'Mostrar nombres menos usados de Enfermería · turno largo · puesto 1',
    });
    expect(more).toHaveTextContent('');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(screen.getAllByRole('option', { name: 'Berta Poco' })).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Enfermería · turno largo · puesto 1'), {
      target: { value: 'Berta Poco' },
    });
    expect(update).toHaveBeenCalledWith('day', 0, 'Berta Poco');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Ocultar nombres menos usados de Enfermería · turno largo · puesto 1',
      })
    );
    expect(screen.queryByRole('option', { name: 'Berta Poco' })).not.toBeInTheDocument();
  });
  it('shows a short label but saves the canonical nurse name', () => {
    const update = vi.fn();
    render(
      <NurseSelector
        nursesDayShift={['Ana Soto', '']}
        nursesNightShift={['', '']}
        nursesList={['Ana Maria Soto Rojas']}
        onUpdateNurse={update}
      />
    );
    expect(screen.getAllByRole('option', { name: 'Ana Soto' })).toHaveLength(4);
    expect(screen.getByLabelText('Enfermería · turno largo · puesto 1')).toHaveValue(
      'Ana Maria Soto Rojas'
    );
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Enfermería · turno largo · puesto 1'), {
      target: { value: 'Ana Maria Soto Rojas' },
    });
    expect(update).toHaveBeenCalledWith('day', 0, 'Ana Maria Soto Rojas');
  });
  it('keeps selected staff visible even when the catalog has not hydrated yet', () => {
    render(
      <NurseSelector
        nursesDayShift={['Enfermera Claudia', '']}
        nursesNightShift={['', '']}
        nursesList={[]}
        onUpdateNurse={vi.fn()}
      />
    );

    expect(screen.getAllByRole('option', { name: 'Enfermera Claudia' }).length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue('Enfermera Claudia')).toHaveLength(1);
  });

  it('reconciles the selected Eloísa alias without deleting possible catalog homonyms', () => {
    render(
      <NurseSelector
        nursesDayShift={['Pedro Moreno Opazo', '']}
        nursesNightShift={['', '']}
        nursesList={['Pedro Moreno', 'Pedro Moreno Opazo', 'Camila Soto', 'Camila Soto Alegria']}
        onUpdateNurse={vi.fn()}
      />
    );

    expect(screen.getAllByDisplayValue('Pedro Moreno Opazo')).toHaveLength(1);
    expect(screen.getAllByRole('option', { name: 'Pedro Moreno' })).toHaveLength(4);
    expect(screen.getAllByRole('option', { name: 'Pedro Moreno Opazo' })).toHaveLength(4);
    expect(screen.getAllByRole('option', { name: 'Camila Soto' })).toHaveLength(4);
    expect(screen.getAllByRole('option', { name: 'Camila Soto Alegria' })).toHaveLength(4);
  });

  it('opens the catalog from the title area and shows a superscript marker only for adjusted shifts', () => {
    const onOpenDetailedStaffing = vi.fn();

    render(
      <NurseSelector
        nursesDayShift={['Enfermera Claudia', '']}
        nursesNightShift={['', '']}
        nursesList={[]}
        onUpdateNurse={vi.fn()}
        shiftIndicators={{
          day: { hasSpecialSchedule: true, extraCount: 1 },
          night: { hasSpecialSchedule: false, extraCount: 0 },
        }}
        onOpenDetailedStaffing={onOpenDetailedStaffing}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir catálogo de Enfermería' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Abrir configuración detallada de Enfermería' })
    );

    expect(setShowNurseManager).toHaveBeenCalledWith(true);
    expect(onOpenDetailedStaffing).toHaveBeenCalledTimes(1);
    expect(screen.getByText('*')).toBeInTheDocument();
    expect(screen.queryByText('+1')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Horario especial en Enfermería turno Largo')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Configurar detalle de Enfermería turno Largo')
    ).not.toBeInTheDocument();
  });

  it('shows an explicit vacancy option instead of legacy blank markers', () => {
    render(
      <NurseSelector
        nursesDayShift={['', '--']}
        nursesNightShift={['', '']}
        nursesList={[]}
        onUpdateNurse={vi.fn()}
      />
    );

    expect(screen.getAllByRole('option', { name: VACANCY_LABEL }).length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue(VACANCY_LABEL).length).toBeGreaterThan(0);
  });

  it('renders vacancy selections with a muted disabled-like appearance', () => {
    render(
      <NurseSelector
        nursesDayShift={[VACANCY_LABEL, '']}
        nursesNightShift={['', '']}
        nursesList={['Enfermera Claudia']}
        onUpdateNurse={vi.fn()}
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
