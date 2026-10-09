import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { SPECIALTY_OPTIONS } from '@/constants/clinicalSpecialtyConstants';

interface ValidationRule {
  options: string[];
  dropdown: boolean;
  allowInvalid: boolean;
}

interface Operation {
  kind: string;
  row: number;
  column: number;
  rows: number;
  columns: number;
}

class SheetDouble {
  cells: unknown[][] = Array.from({ length: 120 }, () => Array(10).fill(''));
  operations: Operation[] = [];
  validations = new Map<string, ValidationRule>();
  protections: Array<
    Operation & { description: string; type: string; editors: string[]; unprotected: Operation[] }
  > = [];
  filter: { rowCount: number; remove: () => void } | null = null;
  insertions: Array<[number, number]> = [];

  getLastRow() {
    for (let row = this.cells.length - 1; row >= 0; row -= 1) {
      if (this.cells[row].some(value => value !== '' && value !== null)) return row + 1;
    }
    return 0;
  }

  getLastColumn() {
    return this.cells.reduce((max, row) => {
      const last = row.reduce<number>(
        (index, value, column) => (value !== '' ? column + 1 : index),
        0
      );
      return Math.max(max, last);
    }, 0);
  }

  getMaxRows() {
    return this.cells.length;
  }
  getMaxColumns() {
    return 10;
  }
  setFrozenRows() {}
  setColumnWidth() {}
  showColumns() {}
  hideColumns() {}
  setRowHeight() {}
  setRowHeights() {}
  getFilter() {
    return this.filter;
  }

  insertRowsBefore(row: number, count: number) {
    this.insertions.push([row, count]);
    this.cells.splice(row - 1, 0, ...Array.from({ length: count }, () => Array(10).fill('')));
  }

  insertRowsAfter(row: number, count: number) {
    this.cells.splice(row, 0, ...Array.from({ length: count }, () => Array(10).fill('')));
  }

  getProtections(type = 'RANGE') {
    return this.protections
      .filter(p => p.type === type)
      .map(item => ({
        getDescription: () => item.description,
        remove: () => {
          this.protections = this.protections.filter(p => p !== item);
        },
      }));
  }

  getRange(rowOrA1: number | string, column = 1, rows = 1, columns = 1) {
    let row: number;
    if (typeof rowOrA1 === 'string') {
      const match = /^([A-J])(\d+)$/.exec(rowOrA1);
      if (!match) throw new Error('Unexpected A1 range');
      row = Number(match[2]);
      column = match[1].charCodeAt(0) - 64;
    } else row = rowOrA1;
    const operation = (kind: string) => ({ kind, row, column, rows, columns });
    const range = {
      bounds: operation('range'),
      getValues: () =>
        Array.from({ length: rows }, (_, r) =>
          Array.from({ length: columns }, (_, c) => this.cells[row + r - 1][column + c - 1])
        ),
      setValues: (values: unknown[][]) => {
        this.operations.push(operation('write'));
        values.forEach((valuesRow, r) =>
          valuesRow.forEach((value, c) => {
            this.cells[row + r - 1][column + c - 1] = value;
          })
        );
        return range;
      },
      setValue: (value: unknown) => range.setValues([[value]]),
      clearContent: () => {
        this.operations.push(operation('clear'));
        for (let r = 0; r < rows; r += 1)
          for (let c = 0; c < columns; c += 1) {
            this.cells[row + r - 1][column + c - 1] = '';
          }
        return range;
      },
      setDataValidation: (rule: ValidationRule) => {
        for (let r = 0; r < rows; r += 1)
          for (let c = 0; c < columns; c += 1) {
            this.validations.set(`${row + r}:${column + c}`, rule);
          }
        return range;
      },
      setBackground: () => range,
      setFontColor: () => range,
      setFontWeight: () => range,
      setFontSize: () => range,
      setVerticalAlignment: () => range,
      setWrap: () => range,
      setNote: () => range,
      merge: () => range,
      mergeAcross: () => range,
      createFilter: () => {
        this.filter = {
          rowCount: rows,
          remove: () => {
            this.filter = null;
          },
        };
      },
      protect: () => this.makeProtection(operation('protect'), 'RANGE'),
    };
    return range;
  }

  protect() {
    return this.makeProtection(
      { kind: 'protect', row: 1, column: 1, rows: this.getMaxRows(), columns: 10 },
      'SHEET'
    );
  }
  makeProtection(operation: Operation, type: string) {
    const item = {
      ...operation,
      type,
      description: '',
      editors: [] as string[],
      unprotected: [] as Operation[],
    };
    this.protections.push(item);
    const protection = {
      setDescription: (description: string) => {
        item.description = description;
        return protection;
      },
      setWarningOnly: (warning: boolean) => {
        if (warning) throw new Error('Warning is not a restriction');
        return protection;
      },
      addEditor: (email: string) => {
        item.editors.push(email);
        return protection;
      },
      addEditors: (emails: string[]) => {
        item.editors.push(...emails);
        return protection;
      },
      getEditors: () => item.editors,
      removeEditors: () => {
        item.editors = [];
        return protection;
      },
      canDomainEdit: () => true,
      setDomainEdit: (enabled: boolean) => {
        if (enabled) throw new Error('Domain access must stay disabled');
        return protection;
      },
      setUnprotectedRanges: (ranges: Array<{ bounds: Operation }>) => {
        item.unprotected = ranges.map(r => r.bounds);
        return protection;
      },
    };
    return protection;
  }
  value(row: number, column: number) {
    return this.cells[row - 1][column - 1];
  }
  isProtected(row: number, column: number, email = 'general@example.org') {
    const contains = (p: Operation) =>
      row >= p.row && row < p.row + p.rows && column >= p.column && column < p.column + p.columns;
    return this.protections.some(
      p => contains(p) && !p.editors.includes(email) && !p.unprotected.some(contains)
    );
  }
}

const loadRuntime = (specialists = 'specialist@example.org') => {
  const source = readFileSync(
    path.join(process.cwd(), 'integrations/google-apps-script/medical-handoff/Code.gs'),
    'utf8'
  );
  const context = vm.createContext({
    Utilities: {
      DigestAlgorithm: { SHA_384: 'SHA_384' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_algorithm: string, value: string) =>
        Array.from(createHash('sha384').update(value).digest()).map(byte =>
          byte > 127 ? byte - 256 : byte
        ),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => specialists }) },
    Session: { getEffectiveUser: () => 'owner@example.org' },
    SpreadsheetApp: {
      ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
      newDataValidation: () => {
        const rule: ValidationRule = { options: [], dropdown: false, allowInvalid: false };
        const builder = {
          requireValueInList: (options: string[], dropdown: boolean) => {
            rule.options = Array.from(options);
            rule.dropdown = dropdown;
            return builder;
          },
          setAllowInvalid: (value: boolean) => {
            rule.allowInvalid = value;
            return builder;
          },
          build: () => rule,
        };
        return builder;
      },
    },
    console,
  });
  vm.runInContext(source, context);
  return context as unknown as {
    upsertHhrRows_: (sheet: SheetDouble, rows: Record<string, string>[]) => number;
    configureHhrSheet_: (sheet: SheetDouble, dataLastRow: number) => void;
  };
};

const incoming = (id = 'one') => ({
  stableKey: `episode:${id}`,
  bed: 'R1',
  patientName: 'Paciente de prueba',
  age: '40a',
  admissionDate: '09-10-2026',
  diagnosis: 'Diagnóstico de prueba',
  specialty: '',
  treatingPhysician: '',
});

const refresh = (sheet: SheetDouble, rows = [incoming()]) => {
  const runtime = loadRuntime();
  runtime.configureHhrSheet_(sheet, runtime.upsertHhrRows_(sheet, rows));
};

describe('collaborative medical handoff template', () => {
  it('offers EDF / Especialista and every HHR specialty beside the new observations column', () => {
    const sheet = new SheetDouble();
    refresh(sheet);

    expect(sheet.cells[0].slice(6, 10)).toEqual([
      'Entrega de turno',
      'Observaciones',
      'Indicaciones médicas',
      '_hhr_key',
    ]);
    expect(sheet.validations.get('2:9')).toMatchObject({
      options: ['EDF', 'Especialista'],
      dropdown: true,
    });
    expect(sheet.validations.get('2:5')?.options).toEqual(SPECIALTY_OPTIONS);
    expect(sheet.value(5, 1)).toContain('evaluación y validación');
    expect(sheet.value(6, 1)).toContain('Nuevos ingresos');
    expect(sheet.value(7, 1)).toBe('Cama');
    expect(sheet.value(7, 2)).toBe('Paciente');
    expect(sheet.value(7, 3)).toBe('Fecha de ingreso');
    expect(sheet.value(7, 4)).toBe('Diagnóstico');
    expect(sheet.value(7, 7)).toBe('Entrega de turno');
    expect(sheet.value(14, 1)).toContain('Notas compartidas');
    expect(sheet.filter?.rowCount).toBe(2);
  });

  it('allows specialists to edit every main field and general physicians only shared admissions and notes', () => {
    const sheet = new SheetDouble();
    refresh(sheet);

    for (let column = 1; column <= 9; column += 1) {
      expect(sheet.isProtected(2, column)).toBe(true);
      expect(sheet.isProtected(2, column, 'specialist@example.org')).toBe(false);
    }
    expect(sheet.isProtected(2, 10, 'specialist@example.org')).toBe(true);
    for (const column of [1, 2, 3, 4, 7]) expect(sheet.isProtected(8, column)).toBe(false);
    for (const column of [1, 4, 5, 8, 9]) expect(sheet.isProtected(15, column)).toBe(false);
    expect(sheet.isProtected(7, 1)).toBe(true);
    expect(sheet.isProtected(14, 1)).toBe(true);
    expect(sheet.isProtected(5, 1)).toBe(true);
  });

  it('fails closed when no specialist roster is configured and replaces protections without duplication', () => {
    const sheet = new SheetDouble();
    refresh(sheet);
    const runtime = loadRuntime('');
    runtime.configureHhrSheet_(sheet, 2);
    expect(sheet.isProtected(2, 7, 'specialist@example.org')).toBe(true);
    expect(sheet.isProtected(8, 7)).toBe(false);
    expect(sheet.isProtected(15, 1)).toBe(false);
    expect(sheet.protections.filter(p => p.type === 'SHEET')).toHaveLength(1);
  });

  it('preserves manual specialty, responsibility, observations, handoff and shared notes across repeated exports', () => {
    const sheet = new SheetDouble();
    refresh(sheet);
    sheet.getRange(2, 5).setValue('Pediatría');
    sheet.getRange(2, 7).setValue('Entrega escrita por el equipo');
    sheet.getRange(2, 8).setValue('Observación añadida manualmente');
    sheet.getRange(2, 9).setValue('Especialista');
    sheet.getRange(15, 1).setValue('Acuerdo del equipo que debe conservarse');
    sheet.operations = [];

    refresh(sheet, [{ ...incoming(), diagnosis: 'Diagnóstico actualizado', specialty: 'Cirugía' }]);
    refresh(sheet, [{ ...incoming(), specialty: 'Med Interna' }]);

    expect(sheet.value(2, 5)).toBe('Pediatría');
    expect(sheet.value(2, 7)).toBe('Entrega escrita por el equipo');
    expect(sheet.value(2, 8)).toBe('Observación añadida manualmente');
    expect(sheet.value(2, 9)).toBe('Especialista');
    expect(sheet.value(15, 1)).toBe('Acuerdo del equipo que debe conservarse');
    expect(sheet.operations.some(p => p.row === 2 && p.column >= 5 && p.column <= 9)).toBe(false);
  });

  it('moves the shared notes below additional patients without making them census rows or duplicating the footer', () => {
    const sheet = new SheetDouble();
    refresh(sheet);
    sheet
      .getRange(8, 1, 1, 4)
      .setValues([
        ['H1C1', 'Ingreso escrito por el equipo', '10/10/2026 02:00', 'Diagnóstico nuevo'],
      ]);
    sheet.getRange(8, 7).setValue('Pendientes del nuevo ingreso');
    sheet.getRange(15, 1).setValue('Información nueva del equipo');

    refresh(sheet, [incoming(), { ...incoming('two'), bed: 'R2' }]);
    refresh(sheet, [incoming(), { ...incoming('two'), bed: 'R2' }]);

    expect(sheet.insertions).toEqual([
      [6, 8],
      [5, 1],
    ]);
    expect(sheet.value(3, 2)).toBe('Paciente de prueba (40a)');
    expect(sheet.value(6, 10)).toBe('__hhr_shared_notes__');
    expect(sheet.value(9, 1)).toBe('H1C1');
    expect(sheet.value(9, 2)).toBe('Ingreso escrito por el equipo');
    expect(sheet.value(9, 3)).toBe('10/10/2026 02:00');
    expect(sheet.value(9, 4)).toBe('Diagnóstico nuevo');
    expect(sheet.value(9, 7)).toBe('Pendientes del nuevo ingreso');
    expect(sheet.value(16, 1)).toBe('Información nueva del equipo');
    expect(sheet.cells.filter(row => row[9] === '__hhr_shared_notes__')).toHaveLength(1);
    expect(sheet.cells.filter(row => row[9] === '__hhr_new_admissions__')).toHaveLength(1);
    expect(sheet.filter?.rowCount).toBe(3);
    expect(sheet.isProtected(9, 1)).toBe(false);
    expect(sheet.isProtected(16, 1)).toBe(false);
  });

  it('inserts the new admissions table without losing notes from the published template', () => {
    const sheet = new SheetDouble();
    const runtime = loadRuntime();
    runtime.configureHhrSheet_(sheet, runtime.upsertHhrRows_(sheet, [incoming()]));
    // Simulate the published layout, which only had a legend and shared notes.
    sheet.cells.splice(5, 8);
    sheet.getRange(2, 7).setValue('Entrega ya escrita en la planilla del día');
    sheet.getRange(2, 8).setValue('Observaciones ya escritas antes del nuevo formato');
    sheet.getRange(2, 9).setValue('EDF');
    sheet.getRange(7, 1).setValue('Nota existente antes de agregar nuevos ingresos');
    sheet.getRange(18, 1).setValue('Última línea de notas existentes');
    sheet.insertions = [];

    refresh(sheet);
    refresh(sheet);

    expect(sheet.insertions).toEqual([[6, 8]]);
    expect(sheet.value(2, 7)).toBe('Entrega ya escrita en la planilla del día');
    expect(sheet.value(2, 8)).toBe('Observaciones ya escritas antes del nuevo formato');
    expect(sheet.value(2, 9)).toBe('EDF');
    expect(sheet.value(15, 1)).toBe('Nota existente antes de agregar nuevos ingresos');
    expect(sheet.value(26, 1)).toBe('Última línea de notas existentes');
    expect(sheet.cells.filter(row => row[9] === '__hhr_new_admissions__')).toHaveLength(1);
    expect(sheet.filter?.rowCount).toBe(2);
  });

  it('migrates the previous layout without losing historical indications or handoff notes', () => {
    const sheet = new SheetDouble();
    sheet
      .getRange(1, 1, 1, 9)
      .setValues([
        [
          'Cama',
          'Paciente',
          'Fecha de ingreso',
          'Diagnóstico',
          'Especialidad',
          'Médico tratante',
          'Entrega de turno',
          'Indicaciones médicas',
          '_hhr_key',
        ],
      ]);
    sheet
      .getRange(2, 1, 1, 9)
      .setValues([
        [
          'R1',
          'Paciente de prueba',
          '09-10-2026',
          'Diagnóstico de prueba',
          '',
          '',
          'Entrega histórica',
          'Texto de indicaciones previo',
          'episode:one',
        ],
      ]);

    refresh(sheet);
    refresh(sheet);

    expect(sheet.value(2, 7)).toBe('Entrega histórica');
    expect(sheet.value(2, 8)).toBe('');
    expect(sheet.value(2, 9)).toBe('Texto de indicaciones previo');
    expect(sheet.value(2, 10)).toMatch(/^episode-h1:/);
    expect(sheet.validations.get('2:9')?.allowInvalid).toBe(true);
  });
});
