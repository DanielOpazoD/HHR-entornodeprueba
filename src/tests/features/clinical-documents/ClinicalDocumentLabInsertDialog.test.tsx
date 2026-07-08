import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { getLabResults, buildLabSummaryText, searchSyslabExams, fetchSyslabExamDetails } =
  vi.hoisted(() => ({
    getLabResults: vi.fn(),
    buildLabSummaryText: vi.fn(),
    searchSyslabExams: vi.fn(),
    fetchSyslabExamDetails: vi.fn(),
  }));

vi.mock('@/features/laboratory', () => ({
  getLabResults,
  buildLabSummaryText,
}));

vi.mock('@/services/laboratory/syslabService', () => ({
  searchSyslabExams,
  fetchSyslabExamDetails,
}));

import { ClinicalDocumentLabInsertDialog } from '@/features/clinical-documents/components/ClinicalDocumentLabInsertDialog';

describe('ClinicalDocumentLabInsertDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildLabSummaryText.mockReturnValue('Resumen de laboratorio');
    getLabResults.mockResolvedValue({ exams: {} });
    searchSyslabExams.mockResolvedValue({ success: true, data: [] });
    fetchSyslabExamDetails.mockResolvedValue({ success: true, data: [] });
  });

  it('loads cached exams, sorts them by newest first, and inserts cached findings', async () => {
    const onInsert = vi.fn();
    getLabResults.mockResolvedValue({
      exams: {
        older: {
          date: '07/04/2026',
          time: '08:15:00',
          findings: [{ examName: 'PCR', value: '5' }],
        },
        newer: {
          date: '08/04/2026',
          time: '10:30:00',
          findings: [{ examName: 'Leucocitos', value: '12000' }],
        },
      },
    });

    render(
      <ClinicalDocumentLabInsertDialog
        patientRut="11.111.111-1"
        onInsert={onInsert}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/cargando exámenes/i)).toBeInTheDocument();

    const newerExamText = await screen.findByText('08/04/2026 10:30');
    const olderExamText = await screen.findByText('07/04/2026 08:15');
    const newerExamButton = newerExamText.closest('button');
    const olderExamButton = olderExamText.closest('button');

    expect(newerExamButton).toBeTruthy();
    expect(olderExamButton).toBeTruthy();
    expect(newerExamButton).toHaveTextContent('#newer');
    expect(olderExamButton).toHaveTextContent('#older');

    fireEvent.click(newerExamButton!);

    await waitFor(() => {
      expect(onInsert).toHaveBeenCalledWith('Resumen de laboratorio');
    });

    expect(fetchSyslabExamDetails).not.toHaveBeenCalled();
    expect(buildLabSummaryText).toHaveBeenCalledWith(
      [{ examName: 'Leucocitos', value: '12000' }],
      '08/04/2026',
      '10:30:00'
    );
  });

  it('uses live syslab exams when cache is missing and fetches details before inserting', async () => {
    const onInsert = vi.fn();
    searchSyslabExams.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'live-1',
          date: '09/04/2026',
          time: '12:45:00',
          link: 'https://syslab.test/live-1',
        },
      ],
    });
    fetchSyslabExamDetails.mockResolvedValue({
      success: true,
      data: [{ findings: [{ examName: 'Hb', value: '13.2' }] }],
    });

    render(
      <ClinicalDocumentLabInsertDialog
        patientRut="11.111.111-1"
        onInsert={onInsert}
        onClose={vi.fn()}
      />
    );

    const liveExamText = await screen.findByText('09/04/2026 12:45');
    const liveExamButton = liveExamText.closest('button');

    expect(liveExamButton).toHaveTextContent('requiere descarga');

    fireEvent.click(liveExamButton!);

    await waitFor(() => {
      expect(fetchSyslabExamDetails).toHaveBeenCalledWith(['https://syslab.test/live-1']);
      expect(onInsert).toHaveBeenCalledWith('Resumen de laboratorio');
    });

    expect(buildLabSummaryText).toHaveBeenCalledWith(
      [{ examName: 'Hb', value: '13.2' }],
      '09/04/2026',
      '12:45:00'
    );
  });

  it('merges cached and live Syslab exams without dropping live-only dates', async () => {
    getLabResults.mockResolvedValue({
      exams: {
        cached: {
          date: '29/04/2026',
          time: '08:00:00',
          findings: [{ examName: 'PCR', value: '5' }],
        },
      },
    });
    searchSyslabExams.mockResolvedValue({
      success: true,
      data: [
        {
          id: '43092427',
          date: '30/04/2026',
          time: '15:28:51',
          link: 'https://syslab.test/43092427',
        },
        {
          id: '43092446',
          date: '02/05/2026',
          time: '06:09:55',
          link: 'https://syslab.test/43092446',
        },
      ],
    });

    render(
      <ClinicalDocumentLabInsertDialog
        patientRut="10.096.004-4"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText('02/05/2026 06:09')).toBeInTheDocument();
    expect(await screen.findByText('30/04/2026 15:28')).toBeInTheDocument();
    expect(await screen.findByText('29/04/2026 08:00')).toBeInTheDocument();

    const allExamIds = screen.getAllByRole('button').map(button => button.textContent || '');
    expect(allExamIds.join(' ')).toContain('#43092446');
    expect(allExamIds.join(' ')).toContain('#43092427');
    expect(allExamIds.join(' ')).toContain('#cached');
  });

  it('shows the empty state when there are no available exams', async () => {
    render(
      <ClinicalDocumentLabInsertDialog
        patientRut="11.111.111-1"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(
      await screen.findByText(/no hay exámenes disponibles para este paciente/i)
    ).toBeInTheDocument();
  });

  it('surfaces loading and insertion errors to the user', async () => {
    getLabResults.mockRejectedValueOnce(new Error('network'));

    const { rerender } = render(
      <ClinicalDocumentLabInsertDialog
        patientRut="11.111.111-1"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText(/no se pudieron cargar los exámenes/i)).toBeInTheDocument();

    getLabResults.mockResolvedValueOnce({
      exams: {
        empty: {
          date: '09/04/2026',
          time: '15:00:00',
          findings: [],
        },
      },
    });

    rerender(
      <ClinicalDocumentLabInsertDialog
        patientRut="22.222.222-2"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const emptyExamText = await screen.findByText('09/04/2026 15:00');
    const examButton = emptyExamText.closest('button');

    fireEvent.click(examButton!);

    expect(
      await screen.findByText(/no se encontraron resultados para este examen/i)
    ).toBeInTheDocument();
  });
});
