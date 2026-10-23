import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, it, expect } from 'vitest';
import { FIELD_COORDS } from '@/services/pdf/ieehPdfCoordinates';

const REQUIRED_FIELDS = [
  'primerApellido',
  'segundoApellido',
  'nombres',
  'sexoRegistral',
  'nacDia',
  'nacMes',
  'nacAnio',
  'edad',
  'edadUnidad',
  'prevision',
  'procedencia',
  'ingresoHora',
  'ingresoMin',
  'ingresoDia',
  'ingresoMes',
  'ingresoAnio',
  'egresoHora',
  'egresoMin',
  'egresoDia',
  'egresoMes',
  'egresoAnio',
  'diasEstada',
  'condicionEgreso',
  'diagnosticoPrincipal',
  'codigoCIE10',
  'especialidadMedico',
];

describe('IEEH PDF Field Coordinates Governance', () => {
  const entries = Object.entries(FIELD_COORDS);
  let pageSize = { width: 0, height: 0 };

  beforeAll(async () => {
    const templateBytes = await readFile(
      resolve(process.cwd(), 'public/docs/estadistico-egreso.pdf')
    );
    const template = await PDFDocument.load(new Uint8Array(templateBytes));
    pageSize = template.getPage(0).getSize();
  });

  it('all X within page bounds', () => {
    for (const [n, c] of entries) {
      expect(c.x, `${n}.x`).toBeGreaterThan(0);
      expect(c.x, `${n}.x`).toBeLessThan(pageSize.width);
    }
  });

  it('all Y within page bounds', () => {
    for (const [n, c] of entries) {
      expect(c.y, `${n}.y`).toBeGreaterThan(0);
      expect(c.y, `${n}.y`).toBeLessThan(pageSize.height);
    }
  });

  it('maxWidth positive and within page', () => {
    for (const [n, c] of entries) {
      expect(c.maxWidth, `${n}`).toBeGreaterThan(0);
      expect(c.x + c.maxWidth, `${n} overflow`).toBeLessThanOrEqual(pageSize.width);
    }
  });

  it('contains all required fields', () => {
    const names = Object.keys(FIELD_COORDS);
    for (const r of REQUIRED_FIELDS) expect(names).toContain(r);
  });

  it('no duplicate positions', () => {
    const seen = new Map<string, string>();
    for (const [n, c] of entries) {
      const k = `${c.x},${c.y}`;
      expect(seen.has(k), `dup (${k}): ${n} & ${seen.get(k)}`).toBe(false);
      seen.set(k, n);
    }
  });

  it('Ingreso row Y aligned', () => {
    const y = FIELD_COORDS.ingresoHora.y;
    expect(FIELD_COORDS.ingresoMin.y).toBe(y);
    expect(FIELD_COORDS.ingresoDia.y).toBe(y);
    expect(FIELD_COORDS.ingresoMes.y).toBe(y);
    expect(FIELD_COORDS.ingresoAnio.y).toBe(y);
  });

  it('Egreso row Y aligned', () => {
    const y = FIELD_COORDS.egresoHora.y;
    expect(FIELD_COORDS.egresoMin.y).toBe(y);
    expect(FIELD_COORDS.egresoDia.y).toBe(y);
    expect(FIELD_COORDS.egresoMes.y).toBe(y);
    expect(FIELD_COORDS.egresoAnio.y).toBe(y);
  });

  it('Egreso below Ingreso', () => {
    expect(FIELD_COORDS.egresoHora.y).toBeLessThan(FIELD_COORDS.ingresoHora.y);
  });

  it('Diagnóstico below Días Estada', () => {
    expect(FIELD_COORDS.diagnosticoPrincipal.y).toBeLessThan(FIELD_COORDS.diasEstada.y);
  });

  it('Especialidad near bottom', () => {
    expect(FIELD_COORDS.especialidadMedico.y).toBeLessThan(100);
  });
});
