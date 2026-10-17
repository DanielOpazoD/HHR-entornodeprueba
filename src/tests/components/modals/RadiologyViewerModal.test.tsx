import { act, render, waitFor, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mmradMocks = vi.hoisted(() => ({
  search: vi.fn(),
}));

vi.mock('@/services/radiology/mmradService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/radiology/mmradService')>();
  return {
    ...actual,
    searchMMRADExams: mmradMocks.search,
  };
});

import { RadiologyViewerModal } from '@/components/modals/RadiologyViewerModal';

const patient = {
  bedId: 'R2',
  label: 'R2 · Paciente de prueba',
  patientName: 'Paciente de prueba',
  rut: '17.752.753-1',
};

describe('RadiologyViewerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mmradMocks.search.mockResolvedValue({ rut: '17752753-1', examenes: [] });
  });

  it('searches the initial patient once when direct access requests auto-search', async () => {
    render(
      <RadiologyViewerModal
        isOpen
        onClose={vi.fn()}
        patients={[patient]}
        initialPatientRut={patient.rut}
        autoSearchInitialPatient
      />
    );

    await waitFor(() => {
      expect(mmradMocks.search).toHaveBeenCalledTimes(1);
    });
    expect(mmradMocks.search).toHaveBeenCalledWith({
      rut: patient.rut,
      dateFrom: undefined,
      dateTo: undefined,
    });
  });

  it('keeps the existing global viewer in manual-search mode by default', async () => {
    await act(async () => {
      render(
        <RadiologyViewerModal
          isOpen
          onClose={vi.fn()}
          patients={[patient]}
          initialPatientRut={patient.rut}
        />
      );
    });
    expect(mmradMocks.search).not.toHaveBeenCalled();
  });

  it('ignores a late search result after selecting another patient', async () => {
    let finish: (result: unknown) => void = () => undefined;
    mmradMocks.search.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    render(
      <RadiologyViewerModal
        isOpen
        onClose={vi.fn()}
        patients={[
          patient,
          { ...patient, bedId: 'R3', rut: '22.222.222-2', label: 'Otro paciente sintético' },
        ]}
        initialPatientRut={patient.rut}
        autoSearchInitialPatient
      />
    );
    await waitFor(() => expect(mmradMocks.search).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '22.222.222-2' } });
    await act(async () =>
      finish({
        rut: patient.rut,
        examenes: [
          {
            nombre_examen: 'ESTUDIO DEL PACIENTE ANTERIOR',
            mod: 'CT',
            dicom_url: 'https://ris.mmrad.cl/synthetic',
          },
        ],
      })
    );
    expect(screen.queryByText('ESTUDIO DEL PACIENTE ANTERIOR')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver DICOM' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeEnabled();
  });
});
