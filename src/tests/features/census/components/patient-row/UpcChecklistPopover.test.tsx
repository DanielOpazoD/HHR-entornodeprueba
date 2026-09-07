import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UpcChecklistPopover } from '@/features/census/components/patient-row/UpcChecklistPopover';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { UpcChecklistRecord } from '@/domain/upc/upcContracts';
import { loadPatientUpcHistory } from '@/services/patient/patientUpcHistoryService';
vi.mock('@/services/patient/patientUpcHistoryService', () => ({
  loadPatientUpcHistory: vi.fn(async patient => ({
    entries: patient.upcChecklist?.history ?? [],
    warning: null,
  })),
}));

const evaluationContext = {
  date: '2026-09-04',
  bedId: 'R1',
  nursesDayShift: ['Enfermera A', 'Enfermero B'],
  nursesNightShift: [],
};
const actor = { uid: 'test-account', displayName: 'Cuenta de prueba' };
const renderPopover = (
  save = vi.fn().mockResolvedValue(true),
  legacy = false,
  staff = evaluationContext
) => {
  const Harness = () => {
    const [checklist, setChecklist] = useState<UpcChecklistRecord>();
    return (
      <table>
        <tbody>
          <tr>
            <UpcChecklistPopover
              data={DataFactory.createMockPatient('R1', {
                patientName: 'Paciente de prueba',
                isUPC: legacy,
              })}
              checklist={checklist}
              eligible
              actor={actor}
              evaluationContext={staff}
              onSave={async record => {
                const success = await save(record);
                if (success) setChecklist(record);
                return success;
              }}
            />
          </tr>
        </tbody>
      </table>
    );
  };
  return { ...render(<Harness />), save };
};
const chooseNurse = () => {
  expect(screen.queryByLabelText('Turno de enfermería')).not.toBeInTheDocument();
  expect(screen.getAllByRole('option').map(option => option.textContent)).toContain('Enfermero B');
  fireEvent.change(screen.getByLabelText('Enfermero responsable'), {
    target: { value: 'Enfermera A' },
  });
};

describe('UpcChecklistPopover', () => {
  it('keeps the open panel below the measured toolbars, including after resize and scroll', async () => {
    const bar = document.createElement('div');
    bar.setAttribute('data-app-top-bar', '');
    let bottom = 128;
    bar.getBoundingClientRect = () => ({ top: 96, bottom, height: bottom - 96 }) as DOMRect;
    document.body.appendChild(bar);
    try {
      renderPopover();
      fireEvent.click(screen.getByRole('button', { name: 'Evaluación UPC pendiente' }));
      const portal = screen.getByRole('dialog').parentElement;
      await waitFor(() => expect(portal).toHaveStyle({ top: '136px' }));
      bottom = 160;
      fireEvent.resize(window);
      await waitFor(() => expect(portal).toHaveStyle({ top: '168px' }));
      fireEvent.scroll(window);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(portal).toHaveStyle({ top: '168px' });
    } finally {
      bar.remove();
    }
  });

  it('loads history only on request, keeps the draft across views, and makes saving an explicit green action', async () => {
    vi.mocked(loadPatientUpcHistory).mockClear();
    const { save } = renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'Evaluación UPC pendiente' }));
    expect(loadPatientUpcHistory).not.toHaveBeenCalled();
    expect(screen.getByText('Elige el responsable para habilitar Guardar.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Monitorización cardíaca continua/i }));
    chooseNurse();
    const saveButton = screen.getByRole('button', { name: 'Guardar evaluación UPC' });
    expect(saveButton).toBeEnabled();
    expect(saveButton).toHaveClass('bg-emerald-700');
    fireEvent.click(screen.getByRole('button', { name: 'Historial' }));
    await waitFor(() => expect(loadPatientUpcHistory).toHaveBeenCalledOnce());
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Evaluar' }));
    expect(
      screen.getByRole('checkbox', { name: /Monitorización cardíaca continua/i })
    ).toBeChecked();
    expect(screen.getByLabelText('Enfermero responsable')).toHaveValue('Enfermera A');
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar evaluación UPC' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Editar evaluación UPC' }));
    fireEvent.click(screen.getByRole('button', { name: 'Historial' }));
    expect(await screen.findByText('1 evaluaciones · 1/1')).toBeInTheDocument();
  });
  it('allows consultation in read-only mode on UPC beds without offering evaluation controls', async () => {
    render(
      <table>
        <tbody>
          <tr>
            <UpcChecklistPopover
              data={DataFactory.createMockPatient('R1')}
              checklist={{
                uciCriteria: [],
                utiCriteria: [],
                classification: null,
                evaluatedAt: '2026-09-04T12:00:00Z',
              }}
              eligible
              readOnly
              actor={actor}
              evaluationContext={evaluationContext}
              onSave={vi.fn()}
            />
          </tr>
        </tbody>
      </table>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Consultar historial UPC' }));
    expect(
      await screen.findByRole('region', { name: 'Historial de evaluaciones UPC' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Evaluar' })).not.toBeInTheDocument();
  });
  it.each([null, 'UPC_UCI', 'UPC_UTI'] as const)(
    'hides UPC controls on medium beds even with a previous %s evaluation',
    classification => {
      render(
        <table>
          <tbody>
            <tr>
              <UpcChecklistPopover
                data={DataFactory.createMockPatient('H6C2', { isUPC: true })}
                checklist={{
                  uciCriteria: [],
                  utiCriteria: [],
                  classification,
                  evaluatedAt: '2026-09-04T12:00:00Z',
                }}
                eligible={false}
                actor={actor}
                evaluationContext={{ ...evaluationContext, bedId: 'H6C2' }}
                onSave={vi.fn()}
              />
            </tr>
          </tbody>
        </table>
      );
      expect(screen.getByRole('cell')).toHaveTextContent('—');
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByText('Sin criterios')).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
  );
  it('formats the census date and keeps the draft open while scrolling', () => {
    renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'Evaluación UPC pendiente' }));
    expect(screen.getByText('Evaluación UPC pendiente · 4-09-2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Monitorización cardíaca continua/i }));
    chooseNurse();
    fireEvent.scroll(window, { target: { scrollY: 600 } });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /Monitorización cardíaca continua/i })
    ).toBeChecked();
    expect(screen.getByLabelText('Enfermero responsable')).toHaveValue('Enfermera A');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('keeps the nondismissable alert through draft changes and close; only removes it on confirmed persistence', async () => {
    const { save } = renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'Evaluación UPC pendiente' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Monitorización cardíaca continua/i }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar checklist UPC' }));
    expect(screen.getByRole('button', { name: 'Evaluación UPC pendiente' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Evaluación UPC pendiente' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Monitorización cardíaca continua/i }));
    chooseNurse();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar evaluación UPC' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Editar evaluación UPC' })).toHaveTextContent('UTI');
    expect(
      screen.queryByRole('button', { name: 'Evaluación UPC pendiente' })
    ).not.toBeInTheDocument();
  });
  it('does not lose criteria or show success on failure', async () => {
    renderPopover(vi.fn().mockResolvedValue(false));
    fireEvent.click(screen.getByRole('button', { name: 'Evaluación UPC pendiente' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Monitorización cardíaca continua/i }));
    chooseNurse();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar evaluación UPC' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo confirmar');
    expect(
      screen.getByRole('checkbox', { name: /Monitorización cardíaca continua/i })
    ).toBeChecked();
    expect(screen.getByRole('button', { name: 'Evaluación UPC pendiente' })).toBeInTheDocument();
  });
  it('keeps legacy UTI visible while requiring an attributable daily evaluation', () => {
    renderPopover(undefined, true);
    expect(screen.getByRole('button', { name: 'Evaluación UPC pendiente' })).toHaveTextContent(
      'Evaluar'
    );
    expect(screen.getByRole('button', { name: 'Evaluación UPC pendiente' })).toHaveTextContent(
      'UTI'
    );
  });
  it('requires an explicit name with unassigned staff, and can confirm No UPC', async () => {
    const { save } = renderPopover(undefined, false, {
      ...evaluationContext,
      nursesDayShift: [],
      nursesNightShift: [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Evaluación UPC pendiente' }));
    expect(screen.getByRole('button', { name: 'Confirmar sin criterios UPC' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Nombre del enfermero responsable'), {
      target: { value: 'Enfermera nocturna' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar sin criterios UPC' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({
      classification: null,
      responsibleNurse: { source: 'manual' },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Editar evaluación UPC' })).toHaveTextContent(
      'Sin criterios'
    );
  });
  it('keeps the form open until persistence is confirmed, then restores trigger focus', async () => {
    let finish!: (confirmed: boolean) => void;
    const saving = new Promise<boolean>(resolve => {
      finish = resolve;
    });
    renderPopover(vi.fn().mockReturnValue(saving));
    fireEvent.click(screen.getByRole('button', { name: 'Evaluación UPC pendiente' }));
    chooseNurse();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar sin criterios UPC' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmando guardado…' })).toBeDisabled();
    finish(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Editar evaluación UPC' })).toHaveFocus();
  });
});
