import '../../../features/laboratory/labAnalyticsController.testSupport';

import { describe, expect, it } from 'vitest';
import { buildAnalysisData } from '@/features/laboratory';
import {
  buildLabDayRows,
  buildLabSeriesModel,
  buildNiceTicks,
  calendarDaysBetween,
  parseColumnKey,
  selectDefaultLabVariables,
} from '@/features/census/components/clinical-explorer/clinicalExplorerLabModel';
import {
  buildDetail,
  buildExam,
  buildFinding,
} from '../../../features/laboratory/labAnalyticsController.testSupport';

const exams = [
  buildExam({ id: '1', link: 'hhr-syslab-extension://batch/a/exam/1', date: '28/10/2026', time: '19:20:00', exams: ['HEMOGRAMA', 'PCR'] }),
  buildExam({ id: '2', link: 'hhr-syslab-extension://batch/a/exam/2', date: '30/10/2026', time: '07:40:00', exams: ['PERFIL BIOQUIMICO'] }),
  buildExam({ id: '3', link: 'hhr-syslab-extension://batch/a/exam/3', date: '03/11/2026', time: '07:40:00', exams: ['PERFIL BIOQUIMICO'] }),
];
const details = [
  buildDetail({
    url: exams[0].link!,
    findings: [
      buildFinding({ section: 'HEMOGRAMA', analysis: 'Hemoglobina', result: '12,8', unit: 'g/dL', refValue: '12,0 - 16,0' }),
      buildFinding({ section: 'BIOQUIMICA', analysis: 'Proteina C Reactiva', result: '186', unit: 'mg/L', refValue: '0 - 5' }),
      buildFinding({ section: 'BIOQUIMICA', analysis: 'Creatinina', result: '1,1', unit: 'mg/dL', refValue: '0,7 - 1,2' }),
    ],
  }),
  buildDetail({
    url: exams[1].link!,
    findings: [
      buildFinding({ section: 'BIOQUIMICA', analysis: 'Creatinina', result: '1,9', unit: 'mg/dL', refValue: '0,7 - 1,2' }),
      buildFinding({ section: 'BIOQUIMICA', analysis: 'Proteina C Reactiva', result: '<5', unit: 'mg/L', refValue: '0 - 5' }),
      buildFinding({ section: 'BIOQUIMICA', analysis: 'Sodio', result: '136', unit: 'mmol/L', refValue: '135 - 145' }),
    ],
  }),
  buildDetail({
    url: exams[2].link!,
    findings: [
      buildFinding({ section: 'BIOQUIMICA', analysis: 'Creatinina', result: '1,3', unit: 'mg/dL', refValue: '0,7 - 1,2' }),
      buildFinding({ section: 'ORINA', analysis: 'Aspecto', result: 'Claro', unit: '', refValue: '', qualitative: true }),
    ],
  }),
];

describe('clinicalExplorerLabModel', () => {
  const analysis = buildAnalysisData(details, exams);
  const model = buildLabSeriesModel(analysis, exams);

  it('builds one numeric series per variable, in clinical order, skipping bounded values', () => {
    expect(model.variables.map(v => v.name)).toEqual([
      'Creatinina',
      'Proteina C Reactiva',
      'Hemoglobina',
      'Sodio',
    ]);
    const creatinine = model.variables[0];
    expect(creatinine.unit).toBe('mg/dL');
    expect(creatinine.points.map(p => [p.dayIso, p.time, p.value, p.display])).toEqual([
      ['2026-10-28', '19:20', 1.1, '1,1'],
      ['2026-10-30', '07:40', 1.9, '1,9'],
      ['2026-11-03', '07:40', 1.3, '1,3'],
    ]);
    // "<5" has no place on a scale; it stays in the day table.
    expect(model.variables[1].points).toHaveLength(1);
    expect(model.days).toEqual(['2026-10-28', '2026-10-30', '2026-11-03']);
  });

  it('defaults to creatinine, CRP and haemoglobin when present, else the first trends', () => {
    expect(selectDefaultLabVariables(model.variables, 4)).toEqual([
      'Creatinina|mg/dl',
      'Proteina C Reactiva|mg/l',
      'Hemoglobina|g/dl',
    ]);
    expect(selectDefaultLabVariables(model.variables.slice(3), 4)).toEqual(['Sodio|mmol/l']);
  });

  it('lists every result of one day, numeric or not, with time and reference text', () => {
    expect(buildLabDayRows(analysis, '2026-10-30').map(r => [r.name, r.display, r.unit, r.refValue])).toEqual([
      ['Creatinina', '1,9', 'mg/dL', '0,7 - 1,2'],
      ['Proteina C Reactiva', '<5', 'mg/L', '0 - 5'],
      ['Sodio', '136', 'mmol/L', '135 - 145'],
    ]);
    expect(buildLabDayRows(analysis, '2026-11-01')).toEqual([]);
  });

  it('keeps the raw unit on the scale and splits an analysis reported in two units', () => {
    const twoUnits = [
      buildExam({ id: '7', link: 'hhr-syslab-extension://batch/b/exam/7', date: '01/11/2026', time: '08:30:00', exams: ['HEMOGRAMA'] }),
      buildExam({ id: '8', link: 'hhr-syslab-extension://batch/b/exam/8', date: '01/11/2026', time: '08:30:59', exams: ['PERFIL'] }),
      buildExam({ id: '9', link: 'hhr-syslab-extension://batch/b/exam/9', date: '02/11/2026', time: '07:00:00', exams: ['PERFIL'] }),
    ];
    const result = buildAnalysisData(
      [
        buildDetail({ url: twoUnits[0]!.link!, findings: [buildFinding({ section: 'HEMOGRAMA', analysis: 'Recuento Leucocitos', result: '7,280', unit: 'x10^3/ul', refValue: '4,0 - 10,0' })] }),
        buildDetail({ url: twoUnits[1]!.link!, findings: [buildFinding({ section: 'BIOQUIMICA', analysis: 'Creatinina', result: '1,0', unit: 'mg/dL', refValue: '0,7 - 1,2' })] }),
        buildDetail({ url: twoUnits[2]!.link!, findings: [buildFinding({ section: 'BIOQUIMICA', analysis: 'Creatinina', result: '88', unit: 'µmol/L', refValue: '62 - 106' })] }),
      ],
      twoUnits
    );
    const series = buildLabSeriesModel(result, twoUnits);
    expect(series.variables.map(v => [v.name, v.unit, v.points.map(p => p.value)])).toEqual([
      ['Creatinina · mg/dL', 'mg/dL', [1]],
      ['Creatinina · µmol/L', 'µmol/L', [88]],
      ['Recuento Leucocitos', 'x10^3/ul', [7.28]],
    ]);
    expect(series.variables[2]!.points[0]!.display).toBe('7,280');
    // Two orders in the same minute keep their own column.
    const rows = buildLabDayRows(result, '2026-11-01');
    expect(rows.map(r => r.columnKey)).toEqual(['01/11/2026 08:30:59 (#8)', '01/11/2026 08:30:00 (#7)']);
    expect(rows.map(r => r.time)).toEqual(['08:30:59', '08:30:00']);
    expect(selectDefaultLabVariables(series.variables, 4)).toEqual(['Creatinina|mg/dl', 'Creatinina|umol/l']);
    expect(series.variables.map(v => v.id)).toEqual(['Creatinina|mg/dl', 'Creatinina|umol/l', 'Recuento Leucocitos|x10^3/ul']);
  });

  it('reads column keys with and without time and counts calendar days without a device clock', () => {
    expect(parseColumnKey('30/10/2026 07:40')).toEqual({ dayIso: '2026-10-30', time: '07:40' });
    expect(parseColumnKey('30/10/2026 07:40:59 (#2)')).toEqual({ dayIso: '2026-10-30', time: '07:40:59' });
    expect(parseColumnKey('30/10/2026 (#44)')).toEqual({ dayIso: '2026-10-30', time: '' });
    expect(parseColumnKey('Desconocido')).toBeNull();
    expect(calendarDaysBetween('2026-10-28', '2026-11-04')).toBe(7);
    expect(buildNiceTicks(1.1, 1.9)).toEqual({ min: 1, max: 2, ticks: [1, 1.5, 2] });
    expect(buildNiceTicks(38, 210).ticks).toEqual([0, 100, 200, 300]);
  });
});
