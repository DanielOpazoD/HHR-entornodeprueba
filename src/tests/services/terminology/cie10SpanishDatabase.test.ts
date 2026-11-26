// @vitest-environment node
/**
 * Tests: Motor de Búsqueda Local Asíncrono CIE-10 (searchCIE10)
 *
 * FLUJO: El usuario escribe un diagnóstico libre (ej: "diabetes", "HTA", "fractura cadera").
 * La función searchCIE10() carga la base JSON (si no estaba en caché) y busca en los ~8,500 diagnósticos.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  searchCIE10,
  loadCIE10Database,
  CIE10Entry,
} from '@/services/terminology/cie10SpanishDatabase';

/** Helper: normaliza texto para comparaciones (remueve acentos + lowercase) */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Create a mock dataset to avoid actually parsing 8,000 lines in unit testing everywhere
const mockDatabase: CIE10Entry[] = [
  {
    code: 'A09.9',
    description: 'Gastroenteritis y colitis de origen no especificado',
    category: 'Infecciosas',
  },
  { code: 'I10.X', description: 'Hipertension esencial (primaria)', category: 'Circulatorio' },
  { code: 'J18.9', description: 'Neumonia, no especificada', category: 'Respiratorio' },
  {
    code: 'E11.9',
    description: 'Diabetes mellitus no insulinodependiente sin complicaciones',
    category: 'Endocrino',
  },
  { code: 'J93.9', description: 'Neumotorax, no especificado', category: 'Respiratorio' },
  { code: 'S12.0', description: 'Fractura de la primera vertebra cervical', category: 'Traumas' },
  { code: 'S12.9', description: 'Fractura del cuello, parte no especificada', category: 'Traumas' },
  {
    code: 'I21.9',
    description: 'Infarto agudo del miocardio, sin otra especificacion',
    category: 'Circulatorio',
  },
  {
    code: 'J44.9',
    description: 'Enfermedad pulmonar obstructiva cronica, no especificada',
    category: 'Respiratorio',
  },
];

describe('Motor de Búsqueda Asíncrono CIE-10 (searchCIE10)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset any module-level caching (this is tricky in ES modules unless we expose a reset method,
    // but we can mock fetch to return our expected payload).
    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return {
        ok: true,
        json: async () => mockDatabase,
      } as Response;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Base de datos ──
  describe('Carga de base de datos JSON', () => {
    it('debe cargar la base de datos a través de fetch', async () => {
      const db = await loadCIE10Database();
      expect(db).toEqual(mockDatabase);
      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  // ── Validaciones de entrada ──
  describe('Validaciones de entrada', () => {
    it('retorna [] si la consulta tiene espacios vacios', async () => {
      expect(await searchCIE10('')).toEqual([]);
      expect(await searchCIE10('   ')).toEqual([]);
    });

    it('retorna [] si la consulta es undefined/null', async () => {
      expect(await searchCIE10(undefined as unknown as string)).toEqual([]);
      expect(await searchCIE10(null as unknown as string)).toEqual([]);
    });
  });

  // ── Búsqueda por código CIE-10 ──
  describe('Señal 1: Búsqueda por código CIE-10', () => {
    it('encuentra resultados por código: "A09" → códigos que empiezan con A09', async () => {
      const results = await searchCIE10('A09');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].code).toMatch(/^A09/);
    });

    it('encuentra por prefijo de código: "I10"', async () => {
      const results = await searchCIE10('I10');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].code).toMatch(/^I10/);
    });
  });

  // ── Búsqueda por texto de descripción ──
  describe('Señal 2: Búsqueda por texto de descripción', () => {
    it('encuentra por descripción: "diabetes" → resultados con "diabetes"', async () => {
      const results = await searchCIE10('diabetes');
      expect(results.length).toBeGreaterThan(0);
      expect(normalize(results[0].description)).toContain('diabetes');
    });

    it('encuentra por prefijo de palabra: "neumo" → neumonía, neumotórax, etc.', async () => {
      const results = await searchCIE10('neumo');
      expect(results.length).toBeGreaterThan(0);
      const allContainPrefix = results.every(r => normalize(r.description).includes('neumo'));
      expect(allContainPrefix).toBe(true);
    });

    it('búsqueda multipalabra (o subcadena estricta): "fractura del cuello"', async () => {
      const results = await searchCIE10('fractura del cuello');
      expect(results.length).toBeGreaterThan(0);
      const topResult = normalize(results[0].description);
      expect(topResult).toContain('fractura del cuello');
    });
  });

  // ── Límite de resultados ──
  describe('Límites', () => {
    it('nunca retorna más del límite especificado', async () => {
      const results = await searchCIE10('a', 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });
});
