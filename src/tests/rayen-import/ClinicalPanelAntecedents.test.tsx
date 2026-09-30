import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestClinicalAction } = vi.hoisted(() => ({ requestClinicalAction: vi.fn() }));
vi.mock('@/features/rayen-import', () => ({ requestClinicalAction }));

import { ClinicalPanelAntecedents } from '@/features/census/components/patient-row/ClinicalPanelAntecedents';

describe('ClinicalPanelAntecedents', () => {
  beforeEach(() => {
    requestClinicalAction.mockReset();
    requestClinicalAction.mockImplementation(async (_episode: string, operation: string) =>
      operation === 'list'
        ? {
            ok: true,
            entries: [
              {
                id: '8',
                source: 'Primaria',
                date: '20260926 15:53',
                windowEnd: '20260926',
                diagnosis: 'Diagnóstico sintético',
                facility: 'Hospital de prueba',
                type: 'Consulta ambulatoria',
              },
            ],
            warnings: [],
          }
        : operation === 'detail'
          ? {
              ok: true,
              detail: {
                reason: 'Motivo sintético',
                history: 'Evolución sintética',
                professional: 'Profesional de prueba',
                attachments: [{ id: '0', label: 'Adjunto 1' }],
              },
            }
          : { ok: true, opened: true }
    );
  });

  it('mantiene la evolución visible, no repite el diagnóstico y ofrece el adjunto', async () => {
    const view = render(<ClinicalPanelAntecedents clinicalEpisodeId="12" />);
    expect(await screen.findByText('Evolución sintética')).toBeInTheDocument();
    expect(screen.getByText(/26-09-2026 15:53/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ocultar atención' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Diagnóstico sintético')).toHaveLength(1);
    expect(screen.queryByText('Consultar atenciones de urgencia')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Descargar adjunto' }));
    await waitFor(() =>
      expect(requestClinicalAction).toHaveBeenCalledWith('12', 'attachment', 'Primaria:8:0')
    );
    expect(requestClinicalAction.mock.calls.filter(call => call[1] === 'detail')).toHaveLength(1);
    expect(requestClinicalAction).toHaveBeenCalledWith(
      '12',
      'detail',
      'Primaria:8',
      expect.any(AbortSignal)
    );
    view.rerender(<ClinicalPanelAntecedents clinicalEpisodeId="12" />);
    expect(screen.queryByText('Consultando antecedentes…')).not.toBeInTheDocument();
    expect(screen.getByText('Evolución sintética')).toBeInTheDocument();
    expect(requestClinicalAction.mock.calls.filter(call => call[1] === 'list')).toHaveLength(1);
    expect(requestClinicalAction.mock.calls.filter(call => call[1] === 'detail')).toHaveLength(1);
  });

  it('permite consultar años anteriores y carga sus detalles sólo al solicitarlos', async () => {
    requestClinicalAction.mockImplementation(
      async (
        _episode: string,
        operation: string,
        _entryId?: string,
        _signal?: AbortSignal,
        beforeDate?: string
      ) => {
        if (operation === 'list' && beforeDate === '20231007')
          return {
            ok: true,
            entries: [
              {
                id: '99',
                source: 'Primaria',
                date: '20200115 10:30',
                windowEnd: beforeDate,
                facility: 'Hospital',
                diagnosis: 'Antecedente antiguo',
                type: 'Consulta',
              },
            ],
            warnings: [],
            nextBeforeDate: null,
          };
        if (operation === 'list')
          return { ok: true, entries: [], warnings: [], nextBeforeDate: '20231007' };
        return {
          ok: true,
          detail: { reason: '', history: 'Detalle antiguo', professional: '', attachments: [] },
        };
      }
    );
    render(<ClinicalPanelAntecedents clinicalEpisodeId="12" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar período anterior' }));
    expect(await screen.findByText('Antecedente antiguo')).toBeInTheDocument();
    expect(screen.getByText(/15-01-2020 10:30/)).toBeInTheDocument();
    expect(requestClinicalAction.mock.calls.filter(call => call[1] === 'detail')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle de la atención' }));
    expect(await screen.findByText('Detalle antiguo')).toBeInTheDocument();
    expect(requestClinicalAction).toHaveBeenCalledWith(
      '12',
      'detail',
      'Primaria:99',
      expect.any(AbortSignal),
      '20231007'
    );
    expect(
      screen.queryByRole('button', { name: 'Cargar período anterior' })
    ).not.toBeInTheDocument();
  });

  it('reintenta un período parcial y conserva los datos ya obtenidos de la otra fuente', async () => {
    let olderCalls = 0;
    requestClinicalAction.mockImplementation(
      async (
        _episode: string,
        operation: string,
        _entryId?: string,
        _signal?: AbortSignal,
        beforeDate?: string
      ) => {
        if (operation === 'list' && beforeDate === '20231007') {
          olderCalls += 1;
          return olderCalls === 1
            ? {
                ok: true,
                entries: [
                  {
                    id: '99',
                    source: 'Primaria',
                    date: '20200115',
                    facility: 'Hospital',
                    diagnosis: 'Primaria antigua',
                    type: '',
                  },
                ],
                warnings: ['Secundaria no disponible'],
                unavailableSources: ['Secundaria'],
                nextBeforeDate: '20201106',
              }
            : {
                ok: true,
                entries: [
                  {
                    id: '88',
                    source: 'Secundaria',
                    date: '20200116',
                    facility: 'Hospital',
                    diagnosis: 'Secundaria recuperada',
                    type: '',
                  },
                ],
                warnings: ['Primaria no disponible'],
                unavailableSources: ['Primaria'],
                nextBeforeDate: '20201106',
              };
        }
        if (operation === 'list')
          return { ok: true, entries: [], warnings: [], nextBeforeDate: '20231007' };
        return { ok: true, detail: { reason: '', history: '', professional: '', attachments: [] } };
      }
    );
    render(<ClinicalPanelAntecedents clinicalEpisodeId="12" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar período anterior' }));
    expect(await screen.findByText('Primaria antigua')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar período anterior' }));
    expect(await screen.findByText('Secundaria recuperada')).toBeInTheDocument();
    expect(screen.getByText('Primaria antigua')).toBeInTheDocument();
    expect(olderCalls).toBe(2);
  });

  it('descarta períodos del episodio anterior al cambiar de paciente', async () => {
    requestClinicalAction.mockImplementation(
      async (
        episode: string,
        operation: string,
        _entryId?: string,
        _signal?: AbortSignal,
        beforeDate?: string
      ) => {
        if (operation !== 'list') return { ok: true };
        if (episode === '13') return { ok: true, entries: [], warnings: [] };
        if (beforeDate)
          return {
            ok: true,
            entries: [
              {
                id: '99',
                source: 'Secundaria',
                date: '20200115',
                facility: 'Hospital',
                diagnosis: 'Historia del episodio anterior',
                type: '',
              },
            ],
            warnings: [],
            nextBeforeDate: null,
          };
        return { ok: true, entries: [], warnings: [], nextBeforeDate: '20231007' };
      }
    );
    const view = render(<ClinicalPanelAntecedents clinicalEpisodeId="12" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar período anterior' }));
    expect(await screen.findByText('Historia del episodio anterior')).toBeInTheDocument();
    view.rerender(<ClinicalPanelAntecedents clinicalEpisodeId="13" />);
    expect(screen.queryByText('Historia del episodio anterior')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(requestClinicalAction).toHaveBeenCalledWith(
        '13',
        'list',
        undefined,
        expect.any(AbortSignal)
      )
    );
  });

  it('permite reintentar el detalle después de un fallo transitorio', async () => {
    let detailCalls = 0;
    requestClinicalAction.mockImplementation(async (_episode: string, operation: string) => {
      if (operation === 'list') {
        return {
          ok: true,
          entries: [{ id: '8', source: 'Primaria', date: '20260908', facility: 'Hospital' }],
          warnings: [],
        };
      }
      if (operation === 'detail' && detailCalls++ === 0)
        return { ok: false, error: 'Fallo transitorio' };
      return {
        ok: true,
        detail: { reason: '', history: 'Detalle recuperado', professional: '', attachments: [] },
      };
    });
    render(<ClinicalPanelAntecedents clinicalEpisodeId="12" />);
    expect(await screen.findByText('Fallo transitorio')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Detalle recuperado')).toBeInTheDocument();
    expect(detailCalls).toBe(2);
  });

  it('conserva atenciones cargadas durante una actualización parcial', async () => {
    vi.useFakeTimers();
    try {
      let listCalls = 0;
      requestClinicalAction.mockImplementation(async (_episode: string, operation: string) => {
        if (operation === 'list' && listCalls++ > 0)
          return {
            ok: true,
            entries: [
              {
                id: '9',
                source: 'Primaria',
                date: '20260909',
                facility: 'Hospital',
                diagnosis: 'Primaria actual',
                type: '',
              },
            ],
            warnings: ['Fuente secundaria pendiente'],
            unavailableSources: ['Secundaria'],
          };
        if (operation === 'list')
          return {
            ok: true,
            entries: [
              {
                id: '8',
                source: 'Primaria',
                date: '20260908',
                facility: 'Hospital',
                diagnosis: 'Primaria antigua',
                type: '',
              },
              {
                id: '7',
                source: 'Secundaria',
                date: '20260907',
                facility: 'Hospital',
                diagnosis: 'Secundaria conservada',
                type: '',
              },
            ],
            warnings: [],
          };
        return {
          ok: true,
          detail: { reason: '', history: 'Detalle conservado', professional: '', attachments: [] },
        };
      });
      render(<ClinicalPanelAntecedents clinicalEpisodeId="12" />);
      await act(async () => undefined);
      expect(screen.getByText('Detalle conservado')).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTimeAsync(300000));
      expect(screen.queryByText('Primaria antigua')).not.toBeInTheDocument();
      expect(screen.getByText('Primaria actual')).toBeInTheDocument();
      expect(screen.getByText('Secundaria conservada')).toBeInTheDocument();
      expect(screen.getByText('Fuente secundaria pendiente')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
