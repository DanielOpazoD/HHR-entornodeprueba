import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ panel: vi.fn(), action: vi.fn(), print: vi.fn() }));

vi.mock('@/features/rayen-import/clinical-panel', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/rayen-import/clinical-panel')>();
  return {
    ...actual,
    requestClinicalPanel: (...args: unknown[]) => mocks.panel(...args),
    requestClinicalAction: (...args: unknown[]) => mocks.action(...args),
  };
});
vi.mock(
  '@/features/census/components/clinical-explorer/clinicalExplorerPrint',
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import('@/features/census/components/clinical-explorer/clinicalExplorerPrint')
      >();
    return {
      ...actual,
      printHtmlDocument: (html: string, signal?: AbortSignal) => mocks.print(html, signal),
    };
  }
);

import { panelResult } from '../clinicalPanelDrawer.fixture';
import { BEDS } from '@/constants/beds';
import { ClinicalExplorerPrintActions } from '@/features/census/components/clinical-explorer/ClinicalExplorerPrintActions';
import { buildIndicationsPrintHtml } from '@/features/census/components/clinical-explorer/clinicalExplorerPrint';
import { listClinicalExplorerPatients } from '@/features/census/controllers/clinicalExplorerController';
import { DataFactory } from '@/tests/factories/DataFactory';

const [patient] = listClinicalExplorerPatients({
  visibleBeds: BEDS.filter(bed => !bed.isExtra),
  beds: {
    R1: DataFactory.createMockPatient('R1', {
      patientName: 'PACIENTE SINTÉTICO',
      rut: '12.345.678-5',
      clinicalEpisodeId: '147950',
      admissionDate: '2026-07-10',
      pathology: 'Neumonía sintética',
    }),
  },
});

// On 2026-07-13 AMOXICILINA is active and CEFTRIAXONA suspended.
const panelWithActiveIndication = {
  ...panelResult,
  carePlan: {
    ...panelResult.carePlan,
    medicationStates: [
      { id: 7, suspended: true, archived: false },
      { id: 8, suspended: false, archived: false, finalized: false },
    ],
  },
  events: [
    {
      ...panelResult.events[0],
      patientPharmaIndicationResume: [
        panelResult.events[0].patientPharmaIndicationResume[0],
        { ...panelResult.events[0].patientPharmaIndicationResume[1], FINALIZED: false },
      ],
    },
  ],
};

const renderActions = (indicationDate: string | null = '2026-07-13') =>
  render(<ClinicalExplorerPrintActions patient={patient} indicationDate={indicationDate} />);

describe('ClinicalExplorerPrintActions', () => {
  beforeEach(() => {
    mocks.panel.mockReset().mockResolvedValue(panelWithActiveIndication);
    mocks.action.mockReset().mockResolvedValue({ ok: true, opened: true });
    mocks.print.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => act(() => setSessionGeneration(null)));

  it('reads Ficha Médico again and prints only the active indications of the chosen day', async () => {
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir indicaciones' }));
    await waitFor(() => expect(mocks.print).toHaveBeenCalledTimes(1));
    expect(mocks.panel.mock.calls[0][0]).toBe('147950');
    const html = mocks.print.mock.calls[0][0] as string;
    expect(html).toContain('Indicaciones médicas del 13-07-2026');
    expect(html).toContain('AMOXICILINA 500 mg');
    expect(html).not.toContain('CEFTRIAXONA');
    expect(html).toContain('PACIENTE SINTÉTICO');
    expect(screen.getByRole('button', { name: 'Imprimir indicaciones' })).toHaveAttribute(
      'title',
      'Imprimir las indicaciones del 13-07-2026'
    );
  });

  it('says there is nothing to print when the day has no active indication', async () => {
    renderActions('2026-07-20');
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir indicaciones' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Sin indicaciones vigentes el 20-07-2026: no hay nada que imprimir.'
    );
    expect(mocks.print).not.toHaveBeenCalled();
  });

  it('shows a failed read as a failure and prints nothing', async () => {
    mocks.panel.mockResolvedValue({
      events: [],
      carePlan: panelResult.carePlan,
      error: 'Sin sesión',
    });
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir indicaciones' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo leer Ficha Médico: Sin sesión'
    );
    expect(mocks.print).not.toHaveBeenCalled();
  });

  it('releases the controls after a browser print failure and allows retry', async () => {
    mocks.print.mockRejectedValueOnce(new Error('print_unavailable'));
    renderActions();
    const button = screen.getByRole('button', { name: 'Imprimir indicaciones' });
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudieron imprimir las indicaciones.'
    );
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(mocks.print).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('prints nothing if the session changes while Ficha Médico answers', async () => {
    let answer: (value: unknown) => void = () => undefined;
    mocks.panel.mockReturnValue(new Promise(resolve => (answer = resolve)));
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir indicaciones' }));
    act(() => setSessionGeneration('synthetic-other-person'));
    await act(async () => answer(panelWithActiveIndication));
    expect(mocks.print).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each(['Imprimir indicaciones', 'Receta'])(
    'allows a new action after a session change cancels %s without waiting for the old reply',
    async label => {
      let answer: (value: unknown) => void = () => undefined;
      const request = label === 'Receta' ? mocks.action : mocks.panel;
      request.mockReturnValueOnce(new Promise(resolve => (answer = resolve)));
      renderActions();
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
      const signal = request.mock.calls[0][label === 'Receta' ? 3 : 2] as AbortSignal;
      act(() => setSessionGeneration('synthetic-next-session'));
      expect(signal.aborted).toBe(true);
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: label }));
      await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled());
      await act(async () =>
        answer(label === 'Receta' ? { ok: false, error: 'Old reply' } : panelWithActiveIndication)
      );
      expect(screen.queryByRole('alert')).toBeNull();
      expect(mocks.print).toHaveBeenCalledTimes(label === 'Receta' ? 0 : 1);
    }
  );

  it('hands the print a cancellation that a session change triggers before the dialog opens', async () => {
    mocks.print.mockReturnValue(new Promise(() => undefined));
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir indicaciones' }));
    await waitFor(() => expect(mocks.print).toHaveBeenCalledTimes(1));
    const signal = mocks.print.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    act(() => setSessionGeneration('synthetic-other-person'));
    expect(signal.aborted).toBe(true);
  });

  it('opens the official current prescription and reports when Eloísa cannot', async () => {
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Receta' }));
    await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(1));
    expect(mocks.action.mock.calls[0].slice(0, 2)).toEqual(['147950', 'prescription']);
    expect(screen.queryByRole('alert')).toBeNull();

    mocks.action.mockResolvedValue({ ok: false, error: 'Eloísa no tiene receta vigente.' });
    fireEvent.click(screen.getByRole('button', { name: 'Receta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Eloísa no tiene receta vigente.');
  });
});

describe('buildIndicationsPrintHtml', () => {
  it('escapes clinical text and stamps the print time in Rapa Nui', () => {
    const html = buildIndicationsPrintHtml({
      patient: {
        ...patient,
        data: { ...patient.data, patientName: 'NOMBRE <script>alert(1)</script>' },
      },
      date: '2026-11-08',
      indications: [{ title: 'Régimen <b>', text: 'Liviano & fraccionado' }],
      // 03:30 UTC on the 9th is 22:30 on the 8th in Rapa Nui (UTC-5 in November).
      printedAt: new Date('2026-11-09T03:30:00.000Z'),
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('NOMBRE &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Régimen &lt;b&gt;');
    expect(html).toContain('Liviano &amp; fraccionado');
    expect(html).toContain('impresa desde HHR el 08-11-2026 a las 22:30 (hora de Rapa Nui)');
  });
});
