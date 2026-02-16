import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mockTraceabilityModal = vi.fn();

vi.mock('@/features/analytics/components/components/TraceabilityModal', () => ({
  TraceabilityModal: (props: unknown) => {
    mockTraceabilityModal(props);
    return <div data-testid="traceability-modal" />;
  },
}));

import { SpecialtyBreakdownTable } from '@/features/analytics/components/components/SpecialtyBreakdownTable';

describe('SpecialtyBreakdownTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens traceability modal with aerocardal list when clicking Aerocardal value', () => {
    const row = {
      specialty: 'Med Interna',
      pacientesActuales: 5,
      egresos: 2,
      fallecidos: 0,
      traslados: 1,
      aerocardal: 1,
      fach: 1,
      diasOcupados: 20,
      contribucionRelativa: 50,
      tasaMortalidad: 0,
      promedioDiasEstada: 4,
      diasOcupadosList: [],
      egresosList: [],
      trasladosList: [],
      aerocardalList: [
        {
          name: 'Paciente Aero',
          rut: '11.111.111-1',
          date: '2026-02-10',
          bedName: 'UTI 1',
        },
      ],
      fachList: [
        {
          name: 'Paciente Fach',
          rut: '22.222.222-2',
          date: '2026-02-11',
          bedName: 'UTI 2',
        },
      ],
      fallecidosList: [],
    };

    render(<SpecialtyBreakdownTable data={[row]} />);

    fireEvent.click(screen.getByTitle('Ver detalle Aerocardal'));

    const lastCall = mockTraceabilityModal.mock.calls[
      mockTraceabilityModal.mock.calls.length - 1
    ]?.[0] as {
      isOpen: boolean;
      type: string;
      patients: Array<{ name: string }>;
      title: string;
    };

    expect(lastCall.isOpen).toBe(true);
    expect(lastCall.type).toBe('aerocardal');
    expect(lastCall.title).toContain('Aerocardal');
    expect(lastCall.patients).toHaveLength(1);
    expect(lastCall.patients[0]?.name).toBe('Paciente Aero');
  });

  it('opens traceability modal with fach list when clicking FACH value', () => {
    const row = {
      specialty: 'Med Interna',
      pacientesActuales: 5,
      egresos: 2,
      fallecidos: 0,
      traslados: 1,
      aerocardal: 0,
      fach: 1,
      diasOcupados: 20,
      contribucionRelativa: 50,
      tasaMortalidad: 0,
      promedioDiasEstada: 4,
      diasOcupadosList: [],
      egresosList: [],
      trasladosList: [],
      aerocardalList: [],
      fachList: [
        {
          name: 'Paciente Fach',
          rut: '22.222.222-2',
          date: '2026-02-11',
          bedName: 'UTI 2',
        },
      ],
      fallecidosList: [],
    };

    render(<SpecialtyBreakdownTable data={[row]} />);

    fireEvent.click(screen.getByTitle('Ver detalle FACH'));

    const lastCall = mockTraceabilityModal.mock.calls[
      mockTraceabilityModal.mock.calls.length - 1
    ]?.[0] as {
      isOpen: boolean;
      type: string;
      patients: Array<{ name: string }>;
      title: string;
    };

    expect(lastCall.isOpen).toBe(true);
    expect(lastCall.type).toBe('fach');
    expect(lastCall.title).toContain('FACH');
    expect(lastCall.patients).toHaveLength(1);
    expect(lastCall.patients[0]?.name).toBe('Paciente Fach');
  });
});
