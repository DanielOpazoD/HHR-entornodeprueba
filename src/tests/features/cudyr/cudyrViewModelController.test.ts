// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildCudyrRecordVersion,
  buildCudyrViewModel,
} from '@/features/cudyr/controllers/cudyrViewModelController';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import {
  confirmedReportInput,
  reportInput,
  reportPatient,
  reportRecord,
} from '@/tests/services/cudyr/reportFixtures';

const buildTwoPatientReport = (overrides: Parameters<typeof confirmedReportInput>[0] = {}) =>
  buildCudyrReport(
    confirmedReportInput({
      records: [
        reportRecord('2026-10-02', {
          R1: reportPatient(),
          H1C1: reportPatient({
            bedId: 'H1C1',
            clinicalEpisodeId: 'crib',
            bedMode: 'Cuna',
            patientName: 'RN sintético',
          }),
        }),
      ],
      ...overrides,
    })
  );

describe('cudyrViewModelController', () => {
  it('builds deterministic record revisions for present, confirmed empty, and loading states', () => {
    expect(
      buildCudyrRecordVersion({
        date: '2026-10-02',
        record: {
          date: '2026-10-02',
          lastUpdated: '2026-10-02T10:00:00Z',
          rayenSync: { at: '2026-10-02T11:00:00Z' },
          cudyrUpdatedAt: '2026-10-02T12:00:00Z',
        },
      })
    ).toEqual({
      date: '2026-10-02',
      version: 'present:2026-10-02T10:00:00Z:2026-10-02T11:00:00Z:2026-10-02T12:00:00Z',
    });

    expect(
      buildCudyrRecordVersion({
        date: '2026-10-02',
        record: null,
        bootstrapPhase: 'confirmed_empty',
      })
    ).toEqual({ date: '2026-10-02', version: 'missing' });

    expect(
      buildCudyrRecordVersion({
        date: '2026-10-02',
        record: null,
        bootstrapPhase: 'loading',
      })
    ).toEqual({ date: '2026-10-02', version: '' });
  });

  it('derives daily and cumulative compliance, filters rows, and omits confirmed system departures', () => {
    const data = buildTwoPatientReport();
    data.rows.push({
      ...data.rows[0],
      key: 'resolved-departure',
      patientName: 'Salida confirmada',
      resolvedSystemDeparture: true,
      eligibility: 'no_elegible',
    });

    const all = buildCudyrViewModel({
      data,
      date: '2026-10-02',
      filter: 'all',
      selectedRowKey: data.rows[0].key,
      busy: false,
      error: '',
    });

    expect(all.rows).toHaveLength(2);
    expect(all.visibleRows).toHaveLength(2);
    expect(all.dailyPercentage).toBe('100%');
    expect(all.percentage).toBe('100%');
    expect(all.dayHasEnded).toBe(true);
    expect(all.dayPending).toBe(false);
    expect(all.canExport).toBe(true);
    expect(all.selectedRow?.key).toBe(data.rows[0].key);

    const excludedOnly = buildCudyrViewModel({
      data,
      date: '2026-10-02',
      filter: 'no_elegible',
      selectedRowKey: '',
      busy: false,
      error: '',
    });

    expect(excludedOnly.visibleRows.map(row => row.patientName)).toEqual(['RN sintético']);
    expect(excludedOnly.dailyPercentage).toBe('100%');
  });

  it('marks today as not ended and suppresses daily percentage while preserving closed days', () => {
    const data = buildCudyrReport(
      confirmedReportInput({
        generatedAt: '2026-10-03T20:00:00-05:00',
        records: [reportRecord('2026-10-02'), reportRecord('2026-10-03')],
      })
    );

    const viewModel = buildCudyrViewModel({
      data,
      date: '2026-10-03',
      filter: 'all',
      selectedRowKey: '',
      busy: false,
      error: '',
    });

    expect(viewModel.dayHasEnded).toBe(false);
    expect(viewModel.dayPending).toBe(true);
    expect(viewModel.dailyPercentage).toBe('—');
    expect(viewModel.dailyProvisional).toBe(false);
    expect(viewModel.percentage).toBe('100%');
    expect(viewModel.lastEvaluated).toBe('2026-10-02');
  });

  it('flags yesterday before noon as provisional and excludes it from closed monthly totals', () => {
    const data = buildTwoPatientReport({ generatedAt: '2026-10-03T09:00:00-05:00' });
    data.rows.forEach(row => {
      row.applicationPending = true;
    });

    const viewModel = buildCudyrViewModel({
      data,
      date: '2026-10-02',
      filter: 'all',
      selectedRowKey: '',
      busy: false,
      error: '',
    });

    expect(viewModel.dayHasEnded).toBe(true);
    expect(viewModel.dayPending).toBe(true);
    expect(viewModel.dailyProvisional).toBe(true);
    expect(viewModel.dailyPercentage).toBe('100%');
    expect(viewModel.totals.eligible).toBe(0);
    expect(viewModel.percentage).toBe('—');
  });

  it('blocks export and row selection while busy or showing a read-view snapshot', () => {
    const data = buildTwoPatientReport();
    const targetKey = data.rows[0].key;

    const busyState = buildCudyrViewModel({
      data,
      date: '2026-10-02',
      filter: 'all',
      selectedRowKey: targetKey,
      busy: true,
      error: '',
    });
    expect(busyState.canExport).toBe(false);
    expect(busyState.selectedRow).toBeUndefined();

    const snapshotState = buildCudyrViewModel({
      data: { ...data, readViewSnapshot: 'saved' },
      date: '2026-10-02',
      filter: 'all',
      selectedRowKey: targetKey,
      busy: false,
      error: '',
    });
    expect(snapshotState.canExport).toBe(false);
    expect(snapshotState.selectedRow).toBeUndefined();
  });

  it('marks approved reconstructions as official repaired only when nothing remains partial', () => {
    const data = buildTwoPatientReport();
    data.coverage.forEach(day => {
      day.reconstructionApproval = {
        approvedAt: '2026-10-08T20:00:00Z',
        approvedBy: 'Responsable',
        reason: 'Reconstrucción aceptada',
      };
    });
    data.rows
      .filter(row => row.eligibility !== 'no_elegible')
      .forEach(row => {
        row.monthlyEvidence = {
          reportId: 'source',
          sourceDate: '2026-10-03',
          checkedAt: '2026-10-08T20:00:00Z',
          state: 'found',
        };
      });

    const verified = buildCudyrViewModel({
      data,
      date: '2026-10-02',
      filter: 'all',
      selectedRowKey: '',
      busy: false,
      error: '',
    });
    expect(verified.partial).toBe(false);
    expect(verified.isOfficialRepaired).toBe(true);

    const erroredClosedDay = buildCudyrReport(
      reportInput({
        generatedAt: '2026-10-03T20:00:00-05:00',
        records: [reportRecord('2026-10-02')],
      })
    );
    erroredClosedDay.coverage.find(day => day.date === '2026-10-02')!.state = 'error';

    const errored = buildCudyrViewModel({
      data: erroredClosedDay,
      date: '2026-10-03',
      filter: 'all',
      selectedRowKey: '',
      busy: false,
      error: '',
    });
    expect(errored.canExport).toBe(false);
    expect(errored.partial).toBe(true);
    expect(errored.isOfficialRepaired).toBe(false);
  });
});
