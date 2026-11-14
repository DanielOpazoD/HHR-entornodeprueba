import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../features/laboratory/labAnalyticsController.testSupport';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  details: vi.fn(),
  access: vi.fn(),
}));

// The laboratory feature owns the Syslab read; the test replaces its transport and session only.
vi.mock('@/services/laboratory/syslabService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/laboratory/syslabService')>();
  return {
    ...actual,
    searchSyslabExams: (...args: unknown[]) => mocks.search(...args),
    fetchSyslabExamDetails: (...args: unknown[]) => mocks.details(...args),
  };
});
vi.mock('@/features/laboratory/hooks/useSyslabAccess', () => ({
  useSyslabAccess: () => mocks.access(),
}));

import { BEDS } from '@/constants/beds';
import { ClinicalExplorerLab } from '@/features/census/components/clinical-explorer/ClinicalExplorerLab';
import { listClinicalExplorerPatients } from '@/features/census/controllers/clinicalExplorerController';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import {
  buildDetail,
  buildExam,
  buildFinding,
} from '../../../features/laboratory/labAnalyticsController.testSupport';

const DATE = '2026-11-04';
const [patient] = listClinicalExplorerPatients({
  visibleBeds: BEDS.filter(bed => !bed.isExtra),
  beds: {
    H3C1: DataFactory.createMockPatient('H3C1', {
      patientName: 'PACIENTE SINTÉTICO',
      rut: '12.345.678-5',
      clinicalEpisodeId: 'ep-1',
      admissionDate: '2026-10-28',
    }),
  },
});
const connected = {
  state: 'connected',
  message: 'Sesión de Syslab activa.',
  isOpening: false,
  isAwaitingLogin: false,
  refresh: vi.fn(),
  openLogin: vi.fn(),
};
const exams = [
  buildExam({
    id: '9',
    link: 'hhr-syslab-extension://batch/a/exam/9',
    date: '20/10/2026',
    time: '08:00:00',
    exams: ['PCR'],
  }),
  buildExam({
    id: '1',
    link: 'hhr-syslab-extension://batch/a/exam/1',
    date: '28/10/2026',
    time: '19:20:00',
    exams: ['PERFIL'],
  }),
  buildExam({
    id: '2',
    link: 'hhr-syslab-extension://batch/a/exam/2',
    date: '03/11/2026',
    time: '07:40:00',
    exams: ['PERFIL'],
  }),
];
const detailsFor = (links: string[]) => ({
  success: true,
  data: links.map(url =>
    buildDetail({
      url,
      findings: [
        buildFinding({
          section: 'BIOQUIMICA',
          analysis: 'Creatinina',
          result: url.endsWith('/1') ? '1,1' : '1,3',
          unit: 'mg/dL',
          refValue: '0,7 - 1,2',
        }),
        buildFinding({
          section: 'HEMOGRAMA',
          analysis: 'Hemoglobina',
          result: '12,0',
          unit: 'g/dL',
          refValue: '12,0 - 16,0',
        }),
      ],
    })
  ),
});

const renderLab = (tab: 'all' | 'lab' = 'all') => {
  const { wrapper: Wrapper } = createQueryClientTestWrapper();
  const view = render(
    <Wrapper>
      <ClinicalExplorerLab patient={patient} censusDate={DATE} tab={tab} onShowAll={vi.fn()} />
    </Wrapper>
  );
  return {
    ...view,
    switchTo: (next: typeof patient) =>
      view.rerender(
        <Wrapper>
          <ClinicalExplorerLab patient={next} censusDate={DATE} tab={tab} onShowAll={vi.fn()} />
        </Wrapper>
      ),
  };
};

const expandTrends = async (card: HTMLElement) => {
  const toggle = await within(card).findByRole('button', { name: 'Tendencias' });
  fireEvent.click(toggle);
};

describe('ClinicalExplorerLab', () => {
  afterEach(() => act(() => setSessionGeneration(null)));

  beforeEach(() => {
    mocks.search.mockReset();
    mocks.details.mockReset();
    mocks.access.mockReset();
    mocks.access.mockReturnValue(connected);
    mocks.search.mockResolvedValue({ success: true, data: exams });
    mocks.details.mockImplementation((links: string[]) => Promise.resolve(detailsFor(links)));
  });

  it('reads only the reports of this hospitalization and charts one scale per variable', async () => {
    renderLab();
    const card = await screen.findByRole('region', { name: 'Laboratorio' });
    await expandTrends(card);
    // First expansion suspends on the lazy trends chunk: React holds the reveal ≥300 ms, and under coverage on a busy runner it measured up to 1.9 s.
    await within(card).findByRole('img', { name: /Creatinina, 2 resultados/ }, { timeout: 5000 });
    // The report from 20-10 belongs to an earlier attention: it is not even requested.
    expect(mocks.details).toHaveBeenCalledTimes(1);
    expect(mocks.details.mock.calls[0][0]).toEqual([exams[1].link, exams[2].link]);
    expect(card).toHaveTextContent('2 informes');
    expect(within(card).getByRole('img', { name: /Hemoglobina, 2 resultados/ })).toBeVisible();
    // Values keep their source units without interpretation or reference ranges.
    expect(within(card).queryByText(/alto|bajo/i)).toBeNull();
    const table = within(card).getByRole('table');
    expect(table).toHaveTextContent('Creatinina');
    expect(table).toHaveTextContent('1,3');
    expect(table).not.toHaveTextContent('0,7 - 1,2');
    expect(card).toHaveTextContent('Día 03-11-2026');
  });

  it('moves the day table with the arrows and with a point on the chart', async () => {
    renderLab('lab');
    const card = await screen.findByRole('region', { name: 'Laboratorio' });
    await within(card).findByRole('table');
    fireEvent.click(within(card).getByRole('button', { name: 'Día anterior con informes' }));
    expect(card).toHaveTextContent('Día 28-10-2026');
    expect(within(card).getByRole('table')).toHaveTextContent('1,1');
    await expandTrends(card);
    await within(card).findByRole('img', { name: /Creatinina/ });
    fireEvent.click(
      within(card).getByRole('button', { name: /Creatinina 1,3 mg\/dL el 03-11-2026/ })
    );
    expect(card).toHaveTextContent('Día 03-11-2026');
  });

  it('asks for the Syslab session instead of showing an empty laboratory', async () => {
    mocks.access.mockReturnValue({
      ...connected,
      state: 'login-required',
      message: 'Syslab requiere iniciar sesión',
    });
    renderLab();
    const card = await screen.findByRole('region', { name: 'Laboratorio' });
    fireEvent.click(within(card).getByRole('button', { name: 'Iniciar sesión en Syslab' }));
    expect(connected.openLogin).toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
    expect(within(card).queryByText(/Sin informes/)).toBeNull();
  });

  it('shows a failed read as a failure with retry, never as "sin informes"', async () => {
    mocks.search.mockResolvedValueOnce({ success: false, data: [], error: 'Syslab no respondió.' });
    renderLab();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Syslab no respondió.');
    expect(screen.queryByText(/Sin informes/)).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2));
    await screen.findByRole('table');
  });

  it('forgets what it showed when the Eloísa session changes and reads again for the new one', async () => {
    renderLab();
    await expandTrends(await screen.findByRole('region', { name: 'Laboratorio' }));
    await screen.findByRole('img', { name: /Creatinina/ });
    act(() => setSessionGeneration(`synthetic-${Date.now()}`));
    await waitFor(() => expect(screen.queryByRole('img', { name: /Creatinina/ })).toBeNull());
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2));
  });

  it('counts the reports Syslab could not deliver yet instead of treating them as read', async () => {
    mocks.details.mockImplementation((links: string[]) =>
      Promise.resolve({ ...detailsFor(links.slice(0, 1)), omittedUrls: links.slice(1) })
    );
    renderLab();
    const card = await screen.findByRole('region', { name: 'Laboratorio' });
    await within(card).findByRole('table');
    expect(card).toHaveTextContent('2 informes · 1 sin resultado aún');
  });

  it('starts the next patient from the defaults, not from the previous selection', async () => {
    const view = renderLab('lab');
    const card = await screen.findByRole('region', { name: 'Laboratorio' });
    await expandTrends(card);
    await within(card).findByRole('img', { name: /Hemoglobina/ });
    fireEvent.click(within(card).getByRole('button', { name: 'Hemoglobina' }));
    expect(within(card).queryByRole('img', { name: /Hemoglobina/ })).toBeNull();
    const other = {
      ...patient!,
      episodeId: 'ep-2',
      data: { ...patient!.data, rut: '5.844.865-6' },
    };
    view.switchTo(other);
    const next = await screen.findByRole('region', { name: 'Laboratorio' });
    expect(await within(next).findByRole('button', { name: 'Tendencias' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expandTrends(next);
    await within(next).findByRole('img', { name: /Hemoglobina/ });
    fireEvent.click(within(next).getByRole('button', { name: 'Día anterior con informes' }));
    expect(within(next).getByRole('img', { name: /Hemoglobina/ })).toBeVisible();
  });

  it('shows only the charted variables until the rest of the list is asked for', async () => {
    mocks.details.mockImplementation((links: string[]) => {
      const details = detailsFor(links);
      details.data[0].findings.push(
        buildFinding({
          section: 'BIOQUIMICA',
          analysis: 'Potasio',
          result: '4,1',
          unit: 'mEq/L',
          refValue: '3,5 - 5,1',
        })
      );
      return Promise.resolve(details);
    });
    renderLab();
    const card = await screen.findByRole('region', { name: 'Laboratorio' });
    await expandTrends(card);
    await within(card).findByRole('img', { name: /Creatinina/ });
    const variables = within(card).getByRole('group', { name: 'Variables' });
    expect(within(variables).queryByRole('button', { name: 'Potasio' })).toBeNull();
    const more = within(variables).getByRole('button', { name: 'Más exámenes (1)' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    fireEvent.click(within(variables).getByRole('button', { name: 'Potasio' }));
    expect(await within(card).findByRole('img', { name: /Potasio/ })).toBeVisible();
    fireEvent.click(within(variables).getByRole('button', { name: 'Menos exámenes' }));
    expect(within(variables).getByRole('button', { name: 'Potasio' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('starts compact and removes charts when collapsed while retaining the chosen variables', async () => {
    renderLab('lab');
    const card = screen.getByRole('region', { name: 'Laboratorio' });
    await within(card).findByRole('table');
    expect(within(card).queryByRole('img')).toBeNull();
    expect(within(card).queryByRole('group', { name: 'Variables' })).toBeNull();
    expect(card).not.toHaveTextContent('valores sin interpretar');
    await expandTrends(card);
    await within(card).findByRole('img', { name: /Hemoglobina/ });
    fireEvent.click(within(card).getByRole('button', { name: 'Hemoglobina' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Tendencias' }));
    expect(within(card).queryByRole('img')).toBeNull();
    expect(within(card).getByRole('table')).toBeVisible();
    await expandTrends(card);
    await within(card).findByRole('img', { name: /Creatinina/ });
    expect(within(card).queryByRole('img', { name: /Hemoglobina/ })).toBeNull();
    expect(mocks.details).toHaveBeenCalledTimes(1);
  });

  it('says plainly when the hospitalization has no reports', async () => {
    mocks.search.mockResolvedValue({ success: true, data: [exams[0]] });
    renderLab();
    expect(
      await screen.findByText('Sin informes de laboratorio en esta hospitalización.')
    ).toBeVisible();
    expect(mocks.details).not.toHaveBeenCalled();
  });
});
