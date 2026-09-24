import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PatientData } from '@/types/domain/patient';

const state = vi.hoisted(() => ({ beds: {} as Record<string, unknown> }));
const service = vi.hoisted(() => ({
  load: vi.fn(), request: vi.fn(), accept: vi.fn(), manual: vi.fn(),
}));
vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordBeds: () => state.beds,
  useDailyRecordData: () => ({ record: { date: '2026-09-24' } }),
}));
vi.mock('@/services/specialty/specialtyJevClient', () => ({
  loadSpecialtyRoundSetup: service.load,
  resolveSpecialtyJevLabel: (labels: Record<string, string>, code: string) => labels[code] ||
    (/^[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,4})?$/.test(code) ? `CIE-10 ${code}` : null),
  requestSpecialtySuggestion: service.request,
  acceptSpecialtySuggestion: service.accept,
  assignSpecialtyManually: service.manual,
  shouldRetainJevRequestId: () => true,
  describeSpecialtySetupError: (error: unknown) => String(error),
}));

import { SpecialtyRoundWindow } from '@/features/census/components/specialty-round/SpecialtyRoundWindow';

const patient = (bedId: string, name: string, code: string): PatientData => ({
  bedId, bedName: bedId, patientName: name, clinicalEpisodeId: `${bedId}-episode`,
  cie10Code: code, pathology: `Diagnóstico ${code}`, specialty: '',
} as PatientData);

describe('guided specialty census round', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.beds = {
      R1: patient('R1', 'Paciente sintético A', 'M86.2'),
      R2: patient('R2', 'Paciente sintético B', ''),
    };
    service.load.mockResolvedValue({
      labels: { 'M86.2': 'Osteomielitis subaguda' },
      policy: { revision: 1, autoEnabled: false, memoryEnabled: false,
        aiMode: 'consultative', rules: [] },
    });
    service.request.mockResolvedValue({ model: 'jev-1.13.0', promptVersion: '1',
      choice: 'internal_medicine', specialty: 'Med Interna', confidence: 0.8 });
    service.accept.mockResolvedValue(undefined);
    service.manual.mockResolvedValue(undefined);
  });

  it('previews all pending patients, then consults eligible diagnoses and confirms together', async () => {
    render(<SpecialtyRoundWindow date="2026-09-24" disabled={false} onClose={vi.fn()} />);
    expect(await screen.findByText('Dato que se enviará: Osteomielitis subaguda')).toBeVisible();
    expect(screen.getByText('Paciente sintético B')).toBeVisible();
    expect(service.request).not.toHaveBeenCalled();
    expect(service.accept).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Obtener sugerencias Jev (1)' }));
    await waitFor(() => expect(service.request).toHaveBeenCalledOnce());
    expect(service.request.mock.calls[0][2]).toEqual({
      code: 'M86.2', canonicalLabel: 'Osteomielitis subaguda',
    });
    expect(service.accept).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Especialidad de R2' }),
      { target: { value: 'Psiquiatría' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar 2 asignaciones' }));
    await waitFor(() => expect(service.accept).toHaveBeenCalledOnce());
    await waitFor(() => expect(service.manual).toHaveBeenCalledOnce());
    expect(service.accept.mock.calls[0][0]).toMatchObject({ bedId: 'R1', episodeId: 'R1-episode' });
    expect(service.manual.mock.calls[0][0]).toMatchObject({ bedId: 'R2', episodeId: 'R2-episode' });
  });

  it('does not save a proposed specialty after the episode changes', async () => {
    const view = render(<SpecialtyRoundWindow date="2026-09-24" disabled={false} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Obtener sugerencias Jev (1)' }));
    await screen.findByRole('button', { name: 'Confirmar 1 asignación' });
    state.beds = { ...state.beds, R1: patient('R1', 'Paciente reemplazado', 'M86.2') };
    (state.beds.R1 as PatientData).clinicalEpisodeId = 'new-episode';
    view.rerender(<SpecialtyRoundWindow date="2026-09-24" disabled={false} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar 1 asignación' }));
    expect(await screen.findByText('Episodio modificado · actualiza censo')).toBeVisible();
    expect(service.accept).not.toHaveBeenCalled();
    expect(service.manual).not.toHaveBeenCalled();
  });

  it('consults a valid category absent from the catalog using only its CIE-10 code', async () => {
    state.beds = { R2: { ...patient('R2', 'Paciente sintético B', 'F23'),
      cie10Description: 'Texto privado NO DEBE SALIR' } };
    render(<SpecialtyRoundWindow date="2026-09-24" disabled={false} onClose={vi.fn()} />);
    expect(await screen.findByText('Dato que se enviará: CIE-10 F23')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Obtener sugerencias Jev (1)' }));
    await waitFor(() => expect(service.request).toHaveBeenCalledWith(
      expect.objectContaining({ bedId: 'R2' }), expect.any(String),
      { code: 'F23', canonicalLabel: 'CIE-10 F23' }
    ));
    expect(JSON.stringify(service.request.mock.calls)).not.toContain('NO DEBE SALIR');
  });

  it('continues after Strict Mode effect replay and retries AI acceptance as AI', async () => {
    state.beds = { R1: patient('R1', 'Paciente sintético', 'M86.2') };
    service.accept.mockRejectedValueOnce(new Error('Transient')).mockResolvedValue(undefined);
    render(<StrictMode><SpecialtyRoundWindow date="2026-09-24" disabled={false}
      onClose={vi.fn()} /></StrictMode>);
    expect(await screen.findByText('Dato que se enviará: Osteomielitis subaguda', {},
      { timeout: 10000 })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Obtener sugerencias Jev (1)' }));
    await waitFor(() => expect(service.request).toHaveBeenCalledOnce());
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar 1 asignación' }));
    expect(await screen.findByText('No confirmada · reintenta o revisa')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar 1 asignación' }));
    await waitFor(() => expect(service.accept).toHaveBeenCalledTimes(2));
    expect(service.manual).not.toHaveBeenCalled();
  });

  it('keeps an explicit review rule out of the Jev batch', async () => {
    state.beds = { R1: patient('R1', 'Paciente sintético', 'M86.2') };
    service.load.mockResolvedValue({ labels: { 'M86.2': 'Osteomielitis subaguda' },
      policy: { revision: 2, autoEnabled: true, memoryEnabled: false,
        aiMode: 'consultative', rules: [{ id: 'review_m86_2', kind: 'review',
          cie10Code: 'M86.2', scope: 'all', revision: 1 }] } });
    render(<SpecialtyRoundWindow date="2026-09-24" disabled={false} onClose={vi.fn()} />);
    expect(await screen.findByText('Regla exige revisión manual')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Obtener sugerencias Jev (0)' })).toBeDisabled();
    expect(service.request).not.toHaveBeenCalled();
  });
});
