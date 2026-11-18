import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { searchMMRADExams, writeTextMock } = vi.hoisted(() => ({
  searchMMRADExams: vi.fn(),
  writeTextMock: vi.fn(),
}));

vi.mock('@/features/radiology/services/mmradService', () => ({
  searchMMRADExams,
}));

import { ClinicalDocumentMMRADCopyDialog } from '@/features/clinical-documents/components/ClinicalDocumentMMRADCopyDialog';

describe('ClinicalDocumentMMRADCopyDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeTextMock.mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });
    searchMMRADExams.mockResolvedValue({
      rut: '11111111-1',
      examenes: [
        {
          nombre_examen: 'TC TORAX',
          fecha_examen: '12/04/2026 11:47',
          fecha_asignacion: '12/04/2026 12:00',
          mod: 'CT',
          estado: 'Validado',
          pdf_url: null,
          dicom_url: null,
          informe_html_url: 'https://ris.mmrad.cl/report/1',
          report: {
            title: 'TOMOGRAFÍA SIMPLE DE TÓRAX',
            technique: null,
            antecedentesClinicos: null,
            findings: 'Hallazgo de prueba.',
            impression: 'Impresión de prueba.',
          },
        },
      ],
    });
  });

  it('loads CT reports from the last 30 days and copies the formatted text', async () => {
    render(<ClinicalDocumentMMRADCopyDialog patientRut="11.111.111-1" onClose={vi.fn()} />);

    expect(await screen.findByText('TC TORAX')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /copiar informe/i }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(
        'TAC de Tórax (12-04-2026).\n\nHallazgos: Hallazgo de prueba.\n\nImpresión: Impresión de prueba.'
      );
    });

    expect(await screen.findByRole('button', { name: /copiado/i })).toBeInTheDocument();
  });
});
