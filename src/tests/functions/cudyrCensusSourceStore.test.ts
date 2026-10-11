import { utils, write } from 'xlsx';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
const require = createRequire(import.meta.url);
const {
  parseCensusSource,
  readCudyrCensusSources,
} = require('../../../functions/lib/cudyrCensusSourceStore.js');
const book = utils.book_new();
utils.book_append_sheet(
  book,
  utils.aoa_to_sheet([
    ['CENSO DIARIO DE PACIENTES'],
    ['Fecha: 01-08-2026'],
    ['N°', 'NOMBRES Y APELLIDOS', 'ALTA', 'TRASLADO', 'FALLECIDO'],
    [1, 'Paciente sintético', 'NO', 'NO', 'NO'],
  ]),
  'Censo'
);
const input = () => ({
  confirmed: true,
  observedAt: '2026-09-02T18:00:00Z',
  base64: write(book, { bookType: 'biff8', type: 'base64' }),
  source: {
    date: '2026-08-01',
    patients: [
      { name: 'Paciente sintético', discharged: false, transferred: false, deceased: false },
    ],
  },
});
describe('historical census archive boundary', () => {
  it('accepts a structurally valid zero-patient census but rejects missing movement headers', () => {
    const emptyBook = utils.book_new();
    const rows = [
      ['CENSO DIARIO DE PACIENTES'],
      ['Fecha: 01-08-2026'],
      ['N°', 'NOMBRES Y APELLIDOS', 'ALTA', 'TRASLADO', 'FALLECIDO'],
    ];
    utils.book_append_sheet(emptyBook, utils.aoa_to_sheet(rows), 'Censo');
    const data = {
      ...input(),
      source: { date: '2026-08-01', patients: [] },
      base64: write(emptyBook, { bookType: 'biff8', type: 'base64' }),
    };
    expect(parseCensusSource(data).source.patients).toEqual([]);
    rows[2] = rows[2].filter(column => column !== 'TRASLADO');
    emptyBook.Sheets.Censo = utils.aoa_to_sheet(rows);
    data.base64 = write(emptyBook, { bookType: 'biff8', type: 'base64' });
    expect(() => parseCensusSource(data)).toThrow();
  });
  it('accepts text ordinals and rejects malformed nonempty rows instead of archiving an empty census', () => {
    const data = input();
    const fixture = (ordinal: string, name: string) => {
      const book = utils.book_new();
      utils.book_append_sheet(
        book,
        utils.aoa_to_sheet([
          ['CENSO DIARIO DE PACIENTES'],
          ['Fecha: 01-08-2026'],
          ['N°', 'NOMBRES Y APELLIDOS', 'ALTA', 'TRASLADO', 'FALLECIDO'],
          [ordinal, name, 'NO', 'NO', 'NO'],
          ['', 'TOTALES', 0, 0, 0],
        ]),
        'Censo'
      );
      return write(book, { bookType: 'biff8', type: 'base64' });
    };
    data.base64 = fixture('1', 'Paciente sintético');
    expect(parseCensusSource(data).source.patients).toHaveLength(1);
    data.base64 = fixture('unexpected', 'Paciente sintético');
    data.source.patients = [];
    expect(() => parseCensusSource(data)).toThrow();
  });
  it('rejects corrupted archived census projections and missing original bytes', async () => {
    const raw = input(),
      parsed = parseCensusSource(raw);
    const report = { ...parsed, date: parsed.source.date };
    let exists = true;
    const q: any = {
      where: () => q,
      orderBy: () => q,
      limit: () => q,
      get: async () => ({ size: 1, docs: [{ data: () => report }] }),
    };
    const hospital = {
      collection: (name: string) =>
        name === 'cudyrCensusSources'
          ? q
          : {
              doc: () => ({ get: async () => ({ exists, data: () => ({ base64: raw.base64 }) }) }),
            },
    };
    expect((await readCudyrCensusSources(hospital, { month: '2026-08' })).reports).toHaveLength(1);
    exists = false;
    await expect(readCudyrCensusSources(hospital, { month: '2026-08' })).rejects.toThrow();
    exists = true;
    report.source.patients[0].name = 'Tampered';
    await expect(readCudyrCensusSources(hospital, { month: '2026-08' })).rejects.toThrow();
  });
  it('retains source and file identity without giving it a clinical episode', () => {
    const parsed = parseCensusSource(input());
    expect(parsed.id).toHaveLength(64);
    expect(parsed.source.patients[0]).not.toHaveProperty('clinicalEpisodeId');
    expect(parseCensusSource(input()).id).toBe(parsed.id);
  });
  it.each([
    'hospital',
    'confirmation',
    'date',
    'timestamp',
    'flags',
    'file',
    'mismatched name',
    'mismatched flag',
  ])('rejects invalid %s', kind => {
    const data: any = input();
    if (kind === 'hospital') data.hospitalId = 'other';
    if (kind === 'confirmation') data.confirmed = false;
    if (kind === 'date') data.source.date = '2026-02-30';
    if (kind === 'timestamp') data.observedAt = 'bad';
    if (kind === 'flags') data.source.patients[0].discharged = 'NO';
    if (kind === 'mismatched name') data.source.patients[0].name = 'Another';
    if (kind === 'mismatched flag') data.source.patients[0].discharged = true;
    if (kind === 'file') data.base64 = 'AA==';
    expect(() => parseCensusSource(data)).toThrow();
  });
});
