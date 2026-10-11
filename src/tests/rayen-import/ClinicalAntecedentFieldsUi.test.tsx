import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { requestClinicalAction, download } = vi.hoisted(() => ({
  requestClinicalAction: vi.fn(),
  download: vi.fn(),
}));
vi.mock('@/features/rayen-import/clinical-panel', () => ({ requestClinicalAction }));
vi.mock('@/services/pdf/antecedentPrescriptionPdf', () => ({
  downloadAntecedentPrescriptionCopy: download,
}));
import { ClinicalAntecedentCard } from '@/features/census/components/patient-row/ClinicalAntecedentCard';
import { ClinicalAntecedentContent } from '@/features/census/components/patient-row/ClinicalAntecedentContent';
const entry = {
  id: '8',
  source: 'Primaria',
  date: '20260929 10:30',
  type: 'Consulta ambulatoria (APS)',
  facility: 'Centro de prueba',
  diagnosis: 'Uno',
};
const detail = {
  reason: 'Motivo sintético',
  history: 'Evolución sintética',
  professional: 'Profesional',
  patientName: 'Paciente sintético',
  diagnoses: ['Uno', 'Dos'],
  indications: ['Indicación sintética'],
  attachments: [],
  prescriptions: [
    {
      id: '123',
      date: '20260929 10:30',
      status: 'Registrada',
      type: 'General',
      items: ['Medicación exacta de prueba'],
    },
  ],
  physicalExams: [
    {
      name: 'Examen Fisico Urgencia',
      fields: [{ label: 'Observación', value: 'Hallazgo sintético' }],
    },
  ],
};
describe('antecedent clinical fields', () => {
  beforeEach(() => {
    requestClinicalAction.mockReset();
    download.mockReset();
    download.mockResolvedValue(undefined);
  });
  it('muestra APS con todos los campos seleccionados y descarga la receta del paciente verificado', async () => {
    requestClinicalAction.mockResolvedValue({
      ok: true,
      detail: { ...detail, careType: 'outpatient' },
    });
    render(<ClinicalAntecedentCard entry={entry} episode="12" />);
    expect(await screen.findByText(/Atención ambulatoria \(APS\)/)).toBeInTheDocument();
    for (const heading of [
      'Motivo de consulta',
      'Enfermedad actual',
      'Diagnósticos',
      'Indicaciones',
      'Prescripciones',
    ])
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getAllByText('Uno')).toHaveLength(1);
    expect(screen.getByText('Dos')).toBeInTheDocument();
    expect(screen.queryByText('Hallazgo sintético')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Descargar copia PDF de receta 123' }));
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        expect.objectContaining({
          patientName: 'Paciente sintético',
          date: '29-09-2026 10:30',
          items: ['Medicación exacta de prueba'],
        }),
        expect.any(AbortSignal)
      )
    );
  });
  it('distingue UEA por el detalle y muestra el examen sin prescripciones ambulatorias', async () => {
    requestClinicalAction.mockResolvedValue({
      ok: true,
      detail: { ...detail, careType: 'emergency' },
    });
    render(<ClinicalAntecedentCard entry={entry} episode="12" />);
    expect(await screen.findByText(/Urgencia \(UEA\)/)).toBeInTheDocument();
    expect(screen.getByText('Hallazgo sintético')).toBeInTheDocument();
    expect(screen.getByText('Indicación sintética')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Prescripciones' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Descargar copia PDF/ })).not.toBeInTheDocument();
  });
  it('cancela la preparación PDF al cambiar de paciente o cerrar la tarjeta', async () => {
    requestClinicalAction.mockResolvedValue({
      ok: true,
      detail: { ...detail, careType: 'outpatient' },
    });
    download.mockImplementation(() => new Promise(() => {}));
    const view = render(<ClinicalAntecedentCard entry={entry} episode="12" />);
    fireEvent.click(await screen.findByRole('button', { name: /Descargar copia PDF/ }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const signal = download.mock.calls[0][1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
  it('cancela una copia al reutilizar la vista con otro paciente y la misma receta', async () => {
    download.mockImplementation(() => new Promise(() => {}));
    const outpatient = { ...detail, careType: 'outpatient' as const };
    const view = render(<ClinicalAntecedentContent detail={outpatient} entry={entry} />);
    fireEvent.click(screen.getByRole('button', { name: /Descargar copia PDF/ }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const signal = download.mock.calls[0][1] as AbortSignal;
    view.rerender(
      <ClinicalAntecedentContent
        detail={{ ...outpatient, patientName: 'Otro paciente sintético' }}
        entry={entry}
      />
    );
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole('button', { name: /Descargar copia PDF/ })).toBeEnabled();
  });
});
