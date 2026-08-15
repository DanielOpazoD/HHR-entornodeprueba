import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MedicalHandoffSpreadsheetAction } from '@/features/handoff/components/MedicalHandoffSpreadsheetAction';
import type { MedicalHandoffSpreadsheetRow } from '@/features/handoff/controllers/medicalHandoffSpreadsheetController';

const success = vi.fn();
const error = vi.fn();

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ success, error }),
}));

const rows: MedicalHandoffSpreadsheetRow[] = [
  {
    stableKey: 'episode:123',
    bed: 'R1',
    patientName: 'Paciente Uno',
    age: '52a',
    admissionDate: '07-08-2026',
    diagnosis: 'Diagnóstico',
    specialty: 'Med Interna',
    treatingPhysician: 'Dra. Aravena',
  },
];

describe('MedicalHandoffSpreadsheetAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the daily sheet and refreshes it when the census date changes', async () => {
    const replace = vi.fn();
    const pendingWindow = {
      closed: false,
      close: vi.fn(),
      document: { title: '' },
      location: { replace },
      opener: window,
    };
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(pendingWindow as unknown as Window);
    const openSpreadsheet = vi.fn().mockResolvedValue({
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-id/edit',
      created: true,
      rowCount: 1,
      date: '2026-08-07',
      storageStatus: 'configured',
    });

    const { rerender } = render(
      <MedicalHandoffSpreadsheetAction
        date="2026-08-07"
        rows={rows}
        openSpreadsheet={openSpreadsheet}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /crear planilla/i }));

    await waitFor(() => expect(openSpreadsheet).toHaveBeenCalledWith({ date: '2026-08-07', rows }));
    expect(replace).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/sheet-id/edit');
    fireEvent.click(screen.getByRole('button', { name: /abrir planilla/i }));
    expect(openWindow).toHaveBeenLastCalledWith(
      'https://docs.google.com/spreadsheets/d/sheet-id/edit',
      '_blank',
      'noopener'
    );

    rerender(
      <MedicalHandoffSpreadsheetAction
        date="2026-08-08"
        rows={rows}
        openSpreadsheet={openSpreadsheet}
      />
    );
    expect(screen.getByRole('button', { name: /crear planilla/i })).toBeInTheDocument();
    openWindow.mockRestore();
  });

  it('reports a recovered institutional folder without exposing technical identifiers', async () => {
    const pendingWindow = {
      closed: false,
      close: vi.fn(),
      document: { title: '' },
      location: { replace: vi.fn() },
      opener: window,
    };
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(pendingWindow as unknown as Window);

    render(
      <MedicalHandoffSpreadsheetAction
        date="2026-08-07"
        rows={rows}
        openSpreadsheet={vi.fn().mockResolvedValue({
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-id/edit',
          created: false,
          rowCount: 1,
          date: '2026-08-07',
          storageStatus: 'recovered',
        })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /crear planilla/i }));

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        'Planilla recuperada',
        'HHR recuperó la carpeta institucional y dejó disponible la entrega médica.'
      )
    );
    expect(JSON.stringify(success.mock.calls)).not.toContain('folder-');
    openWindow.mockRestore();
  });

  it('is disabled when the census has no patients to export', () => {
    render(
      <MedicalHandoffSpreadsheetAction date="2026-08-07" rows={[]} openSpreadsheet={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: /crear planilla/i })).toBeDisabled();
  });

  it('does not call the backend when occupied beds and cribs exceed the row limit', () => {
    const openSpreadsheet = vi.fn();
    const oversizedRows = Array.from({ length: 81 }, (_, index) => ({
      ...rows[0],
      stableKey: `episode:${index}`,
    }));

    render(
      <MedicalHandoffSpreadsheetAction
        date="2026-08-07"
        rows={oversizedRows}
        openSpreadsheet={openSpreadsheet}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /crear planilla/i }));

    expect(openSpreadsheet).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      'No se pudo preparar la planilla',
      expect.stringContaining('máximo de 80 filas')
    );
  });
});
