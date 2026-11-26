import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClinicalInitialBlockEditor } from '@/features/census/components/patient-row/ClinicalInitialBlockEditor';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({ professionalsCatalog: [] }),
}));
const patient = DataFactory.createMockPatient('R1', {
  patientName: 'Paciente sintético',
  clinicalEpisodeId: 'synthetic-episode',
  specialty: 'Med Interna',
});
const props = { data: patient, currentDateString: '2026-01-03', onChange: () => vi.fn() };

describe('clinical editor confirmed saves', () => {
  it('waits for confirmation without converting an untouched specialty into a manual decision', async () => {
    let confirm!: (saved: boolean) => void;
    const onMultipleUpdate = vi.fn(
      (_fields: Partial<typeof patient>) =>
        new Promise<boolean>(resolve => {
          confirm = resolve;
        })
    );
    render(<ClinicalInitialBlockEditor {...props} onMultipleUpdate={onMultipleUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar bloque clínico' }));
    fireEvent.change(screen.getByLabelText('Diagnóstico'), {
      target: { value: 'Diagnóstico sintético' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onMultipleUpdate.mock.calls[0][0]).not.toHaveProperty('specialty');
    expect(screen.getByRole('status')).toHaveTextContent('Guardando cambios');
    expect(screen.getByLabelText('Especialidad')).toBeDisabled();
    expect(screen.getByLabelText('Diagnóstico')).toBeDisabled();
    await act(async () => {
      confirm(true);
    });
    expect(screen.queryByTestId('clinical-block-editor-R1')).toBeNull();
  });

  it('keeps the draft available after a rejected or partially saved form', async () => {
    render(
      <ClinicalInitialBlockEditor {...props} onMultipleUpdate={vi.fn().mockResolvedValue(false)} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Editar bloque clínico' }));
    fireEvent.change(screen.getByLabelText('Diagnóstico'), {
      target: { value: 'Borrador sintético' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo confirmar todo el cambio'
    );
    expect(screen.getByLabelText('Diagnóstico')).toHaveValue('Borrador sintético');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
  });

  it('closes an old draft and ignores a late result when the same bed changes episode', async () => {
    let reject!: (error: Error) => void;
    const onMultipleUpdate = vi.fn(
      () =>
        new Promise<boolean>((_resolve, fail) => {
          reject = fail;
        })
    );
    const view = render(
      <ClinicalInitialBlockEditor {...props} onMultipleUpdate={onMultipleUpdate} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Editar bloque clínico' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    view.rerender(
      <ClinicalInitialBlockEditor
        {...props}
        data={{
          ...patient,
          clinicalEpisodeId: 'replacement-episode',
          pathology: 'Nuevo diagnóstico',
        }}
        onMultipleUpdate={onMultipleUpdate}
      />
    );
    expect(screen.queryByTestId('clinical-block-editor-R1')).toBeNull();
    await act(async () => {
      reject(new Error('synthetic late rejection'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Editar bloque clínico' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Diagnóstico')).toHaveValue('Nuevo diagnóstico');
  });

  it('submits Otro without a free-text specialty description input', async () => {
    const onMultipleUpdate = vi.fn().mockResolvedValue(true);
    render(<ClinicalInitialBlockEditor {...props} onMultipleUpdate={onMultipleUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar bloque clínico' }));
    fireEvent.change(screen.getByLabelText('Especialidad'), { target: { value: 'Otro' } });
    expect(screen.queryByLabelText('Describir especialidad')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });
    expect(onMultipleUpdate).toHaveBeenCalledWith(expect.objectContaining({ specialty: 'Otro' }));
  });
});
