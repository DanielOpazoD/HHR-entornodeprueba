import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuditDocumentsResultPanel } from '@/features/audit-documents/components/AuditDocumentsResultPanel';

describe('audit download result', () => {
  it('flags a history whose change-of-time day comes from the daily summary and an HHR annex', () => {
    render(
      <AuditDocumentsResultPanel
        result={{
          ok: true,
          filename: 'Auditoria_Eloisa_2026-11-02_1610.zip',
          documentCount: 2,
          failedCount: 0,
          summary: [
            {
              run: '111111111',
              name: 'Paciente Prueba Uno',
              hospitalizations: 1,
              unverified: 0,
              downloaded: 2,
              reconstructed: 1,
              incomplete: 0,
              failed: 0,
            },
          ],
        }}
      />
    );

    expect(
      screen.getByText(
        '1 con días que Eloísa no genera, rehechos desde el resumen diario y un anexo HHR no oficial'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Revisa 1 RUT con documentos faltantes');
  });
});
