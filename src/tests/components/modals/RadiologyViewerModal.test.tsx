import { render, waitFor } from '@testing-library/react';
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
    render(
      <RadiologyViewerModal
        isOpen
        onClose={vi.fn()}
        patients={[patient]}
        initialPatientRut={patient.rut}
      />
    );

    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(mmradMocks.search).not.toHaveBeenCalled();
  });
});
