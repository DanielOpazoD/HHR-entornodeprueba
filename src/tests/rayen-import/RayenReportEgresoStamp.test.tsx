import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RayenReportEgresoStamp } from '@/features/rayen-import/components/RayenReportEgresoStamp';

const entry = {
  run: '11.111.111-1',
  encounterId: '910080',
  patientName: 'Rn De Paciente Sintética',
  bedLabel: 'H4C2',
  destino: 'Domicilio',
  fechaEgreso: '13-09-2026 16:44',
  correctedDay: '2026-09-13',
  correctedTime: '14:44',
  kind: 'alta' as const,
  status: 'Vivo' as const,
  fromClinicalCrib: true,
};

describe('Rayen report-only discharge stamp', () => {
  it('shows the Rapa Nui clock instead of the mainland bulk-report clock', () => {
    render(<RayenReportEgresoStamp entry={entry} isPreviousDay={false} />);

    expect(screen.getByText(/13-09-2026 14:44 \(hora isla\)/)).toBeInTheDocument();
    expect(screen.queryByText(/16:44/)).not.toBeInTheDocument();
  });

  it('explains when the movement will be filed on the prior clinical day', () => {
    render(<RayenReportEgresoStamp entry={entry} isPreviousDay />);

    expect(screen.getByText(/se grabará en ese día, no hoy/)).toBeInTheDocument();
  });
});
