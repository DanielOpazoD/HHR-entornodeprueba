import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { StaffContextType } from '@/context/StaffContext';
import { ClinicalInitialBlockEditor } from '@/features/census/components/patient-row/ClinicalInitialBlockEditor';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import { professionalCatalogKey } from '@/services/staff/treatingPhysicianCatalog';

const mockedStaffContext = vi.hoisted(() => ({ value: {} as StaffContextType }));
vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => mockedStaffContext.value,
}));

const contextValue = (
  professionalsCatalog: ProfessionalCatalogItem[],
  setProfessionalsCatalog = vi.fn()
): StaffContextType => ({
  nursesList: [],
  setNursesList: vi.fn(),
  nursesLoading: false,
  tensList: [],
  setTensList: vi.fn(),
  tensLoading: false,
  professionalsCatalog,
  setProfessionalsCatalog,
  professionalsLoading: false,
  showNurseManager: false,
  setShowNurseManager: vi.fn(),
  showTensManager: false,
  setShowTensManager: vi.fn(),
});

const renderEditor = (
  catalog: ProfessionalCatalogItem[],
  patientOverrides: Partial<typeof EMPTY_PATIENT> = {}
) => {
  const onMultipleUpdate = vi.fn();
  mockedStaffContext.value = contextValue(catalog);
  render(
    <ClinicalInitialBlockEditor
      data={{
        ...EMPTY_PATIENT,
        bedId: 'H1C1',
        patientName: 'Paciente prueba',
        pathology: 'Diagnóstico',
        specialty: 'Cirugía',
        ...patientOverrides,
      }}
      onChange={() => vi.fn()}
      onMultipleUpdate={onMultipleUpdate}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Editar bloque clínico' }));
  return onMultipleUpdate;
};

describe('ClinicalInitialBlockEditor treating physician', () => {
  it('auto-selects the configured specialty and saves physician identity atomically', () => {
    const onMultipleUpdate = renderEditor([
      {
        name: 'Angelica Vargas',
        phone: '',
        specialty: 'Psiquiatría',
        rayenPractitionerId: '7947',
        source: 'rayen',
      },
    ]);

    fireEvent.change(screen.getByLabelText('Médico tratante'), {
      target: { value: 'rayen:7947' },
    });

    expect(screen.getByLabelText('Especialidad')).toHaveValue('Psiquiatría');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onMultipleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        treatingPhysicianId: '7947',
        treatingPhysicianName: 'Angelica Vargas',
        specialty: 'Psiquiatría',
      })
    );
  });

  it('keeps specialty manually editable when no physician is assigned', () => {
    const onMultipleUpdate = renderEditor([]);

    fireEvent.change(screen.getByLabelText('Especialidad'), {
      target: { value: 'Pediatría' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onMultipleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        treatingPhysicianId: undefined,
        treatingPhysicianName: undefined,
        specialty: 'Pediatría',
      })
    );
  });

  it('preserves a name-only physician when saving another clinical field', () => {
    const onMultipleUpdate = renderEditor([], {
      treatingPhysicianName: 'Médico histórico',
    });

    expect(screen.getByLabelText('Médico tratante')).toHaveValue(
      'stored-name:M%C3%A9dico%20hist%C3%B3rico'
    );
    fireEvent.change(screen.getByLabelText('Diagnóstico'), {
      target: { value: 'Diagnóstico actualizado' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onMultipleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        pathology: 'Diagnóstico actualizado',
        treatingPhysicianId: undefined,
        treatingPhysicianName: 'Médico histórico',
      })
    );
  });

  it('does not attach an arbitrary Rayen identity when a physician name is ambiguous', () => {
    const onMultipleUpdate = renderEditor(
      [
        {
          name: 'Alex Soto',
          phone: '111',
          specialty: 'Cirugía',
          rayenPractitionerId: '101',
          source: 'rayen',
        },
        {
          name: 'Alex Soto',
          phone: '222',
          specialty: 'Pediatría',
          rayenPractitionerId: '202',
          source: 'rayen',
        },
      ],
      { treatingPhysicianName: 'Alex Soto' }
    );

    expect(screen.getByLabelText('Médico tratante')).toHaveValue('stored-name:Alex%20Soto');
    fireEvent.change(screen.getByLabelText('Diagnóstico'), {
      target: { value: 'Diagnóstico actualizado' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onMultipleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        treatingPhysicianId: undefined,
        treatingPhysicianName: 'Alex Soto',
      })
    );
  });

  it('clears the previous Rayen id when selecting a manual physician', () => {
    const manualPhysician: ProfessionalCatalogItem = {
      name: 'Médico manual',
      phone: '123',
      specialty: 'Cirugía',
    };
    const onMultipleUpdate = renderEditor([manualPhysician], {
      treatingPhysicianId: 'old-rayen-id',
      treatingPhysicianName: 'Médico anterior',
    });

    fireEvent.change(screen.getByLabelText('Médico tratante'), {
      target: { value: professionalCatalogKey(manualPhysician) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onMultipleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        treatingPhysicianId: undefined,
        treatingPhysicianName: 'Médico manual',
      })
    );
  });

  it('keeps patient specialty edits scoped to the patient record', () => {
    const setProfessionalsCatalog = vi.fn();
    const physician: ProfessionalCatalogItem = {
      name: 'Angelica Vargas',
      phone: '',
      specialty: 'Psiquiatría',
      rayenPractitionerId: '7947',
      source: 'rayen',
    };
    mockedStaffContext.value = contextValue([physician], setProfessionalsCatalog);
    const onMultipleUpdate = vi.fn();
    render(
      <ClinicalInitialBlockEditor
        data={{
          ...EMPTY_PATIENT,
          bedId: 'H1C1',
          patientName: 'Paciente prueba',
          specialty: 'Psiquiatría',
          treatingPhysicianId: '7947',
          treatingPhysicianName: 'Angelica Vargas',
        }}
        onChange={() => vi.fn()}
        onMultipleUpdate={onMultipleUpdate}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Editar bloque clínico' }));
    fireEvent.change(screen.getByLabelText('Especialidad'), { target: { value: 'Cirugía' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onMultipleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ specialty: 'Cirugía' })
    );
    expect(setProfessionalsCatalog).not.toHaveBeenCalled();
  });
});
