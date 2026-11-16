import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CudyrExclusionDialog } from '@/features/cudyr/components/CudyrExclusionDialog';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import type { SaveCudyrExclusionRequest } from '@/types/domain/cudyrExclusion';
import { reportInput, reportPatient, reportRecord } from '../../services/cudyr/reportFixtures';

const api = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('@/services/cudyr/cudyrExclusionService', () => ({ saveCudyrExclusion: api.save }));

const DAY = '2026-10-02';
const DISCHARGE_ID = `rayen-egreso:P123456785:${DAY}`;
const rows = () =>
  buildCudyrReport(
    reportInput({
      from: DAY,
      to: DAY,
      records: [
        {
          ...reportRecord(DAY, {
            R1: reportPatient(),
            R2: reportPatient({ clinicalEpisodeId: '', patientName: 'Cama sin episodio' }),
          }),
          discharges: [
            {
              id: DISCHARGE_ID,
              bedName: '',
              bedId: '',
              bedType: '',
              patientName: 'Egreso con pasaporte',
              rut: 'P123456785',
              diagnosis: '',
              time: '03:10',
              status: 'Vivo',
            },
          ],
        },
      ],
    })
  ).rows;
const row = (name: string) => rows().find(item => item.patientName === name)!;
const open = (target: CudyrReportRow) =>
  render(<CudyrExclusionDialog row={target} canEdit onClose={vi.fn()} onSaved={vi.fn()} />);
const reasonOptions = () =>
  within(screen.getByLabelText('Motivo de exclusión'))
    .getAllByRole('option')
    .map(option => (option as HTMLOptionElement).value)
    .filter(Boolean);
const fill = (reason: string) => {
  fireEvent.change(screen.getByLabelText('Motivo de exclusión'), { target: { value: reason } });
  fireEvent.change(screen.getByLabelText('Observación breve'), {
    target: { value: 'Revisado en la ficha de origen.' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar excepción' }));
};
const echo = (request: SaveCudyrExclusionRequest) => ({
  persisted: true,
  exclusion: {
    ...request,
    clinicalEpisodeId: request.clinicalEpisodeId || '',
    id: 'a'.repeat(64),
    revision: 1,
    source: 'manual',
    updatedAt: '2026-10-05T14:00:00Z',
    updatedBy: { uid: 'u', name: 'Revisora', email: 'r@example.com', role: 'nurse_hospital' },
  },
});

describe('daily exception dialog', () => {
  beforeEach(() => {
    api.save.mockReset();
    api.save.mockImplementation(async (request: SaveCudyrExclusionRequest) => echo(request));
  });

  it('saves a discharge without episode by its stored discharge, with only its two reasons', async () => {
    const onSaved = vi.fn();
    render(
      <CudyrExclusionDialog
        row={row('Egreso con pasaporte')}
        canEdit
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );
    expect(screen.queryByText(/Falta un episodio confirmado/)).toBeNull();
    expect(reasonOptions()).toEqual(['not_hospitalized', 'under_eight_hours']);
    fill('under_eight_hours');
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const request = api.save.mock.calls[0][0];
    expect(request).toMatchObject({
      date: DAY,
      dischargeId: DISCHARGE_ID,
      reason: 'under_eight_hours',
    });
    expect(request).not.toHaveProperty('clinicalEpisodeId');
  });

  it('does not confirm a save the server attached to another discharge', async () => {
    api.save.mockImplementation(async (request: SaveCudyrExclusionRequest) => {
      const saved = echo(request);
      return { ...saved, exclusion: { ...saved.exclusion, dischargeId: 'other' } };
    });
    open(row('Egreso con pasaporte'));
    fill('not_hospitalized');
    expect(await screen.findByText(/No se confirmó el guardado remoto/)).toBeTruthy();
  });

  it('keeps an episode row unchanged: all reasons, sent by episode only', async () => {
    open(row('Paciente Sintético'));
    expect(reasonOptions()).toEqual([
      'cma',
      'healthy_crib',
      'not_hospitalized',
      'under_eight_hours',
    ]);
    fill('cma');
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    const request = api.save.mock.calls[0][0];
    expect(request).toMatchObject({ clinicalEpisodeId: 'synthetic-episode', reason: 'cma' });
    expect(request).not.toHaveProperty('dischargeId');
  });

  it('still blocks a bed row without episode', () => {
    open(row('Cama sin episodio'));
    expect(screen.getByRole('alert').textContent).toMatch(/Falta un episodio confirmado/);
    expect(
      (screen.getByRole('button', { name: 'Guardar excepción' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});
