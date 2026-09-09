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
                date: '20260908',
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
    expect(screen.queryByRole('button', { name: 'Ocultar atención' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Diagnóstico sintético')).toHaveLength(1);
    expect(screen.queryByText('Consultar atenciones de urgencia')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Descargar adjunto' }));
    await waitFor(() =>
      expect(requestClinicalAction).toHaveBeenCalledWith('12', 'attachment', 'Primaria:8:0')
    );
    expect(requestClinicalAction.mock.calls.filter(call => call[1] === 'detail')).toHaveLength(1);
    view.rerender(<ClinicalPanelAntecedents clinicalEpisodeId="12" />);
    expect(screen.queryByText('Consultando antecedentes…')).not.toBeInTheDocument();
    expect(screen.getByText('Evolución sintética')).toBeInTheDocument();
    expect(requestClinicalAction.mock.calls.filter(call => call[1] === 'list')).toHaveLength(1);
    expect(requestClinicalAction.mock.calls.filter(call => call[1] === 'detail')).toHaveLength(1);
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
