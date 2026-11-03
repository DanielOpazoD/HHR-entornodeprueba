import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuditDocumentsResultPanel } from '@/features/audit-documents/components/AuditDocumentsResultPanel';

describe('audit download result', () => {
  it('flags a history saved without the day of the change of time', () => {
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
              incomplete: 1,
              failed: 0,
            },
          ],
        }}
      />
    );

    expect(
      screen.getByText('1 sin el día del cambio de hora, que Eloísa no genera')
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Revisa 1 RUT con documentos faltantes');
  });
});
