/**
 * Tests: Servicio de Terminología CIE-10 (terminologyService)
 *
 * FLUJO COMPLETO del selector de diagnósticos:
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ 1. Usuario abre el selector CIE-10                             │
 * │    → Se auto-rellena con el diagnóstico libre (freeTextValue)  │
 * │                                                                │
 * │ 2. searchDiagnoses(query) — Búsqueda por defecto               │
 * │    a. Busca en base local (8,500+ diagnósticos) → instantáneo  │
 * │    b. Revisa caché IA en localStorage                          │
 * │    c. Si hay caché → prioriza IA + complementa con locales     │
 * │    d. Retorna TerminologyConcept[] (máx 15)                    │
 * │                                                                │
 * │ 3. forceAISearch(query) — Solo al pulsar botón "IA"            │
 * │    a. Llama a Gemini API (gemini-3-flash-preview)              │
 * │    b. Guarda resultados en caché localStorage (24h TTL)        │
 * │    c. Retorna IA + local fusionados (sin duplicados)           │
 * │                                                                │
 * │ 4. Al egresar/trasladar paciente                               │
 * │    → createEmptyPatient() limpia cie10Code y cie10Description  │
 * │    → La cama queda vacía para el siguiente paciente            │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * FUNCIONES EXPORTADAS:
 *  - searchDiagnoses(query, signal?) → TerminologyConcept[]
 *  - searchDiagnosesAI(query, signal?) → TerminologyConcept[]  (wrapper de forceAISearch)
 *  - forceAISearch(query, signal?) → TerminologyConcept[]
 *  - getCIE10Description(code) → string | null
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  searchDiagnoses,
  getCIE10Description,
  forceAISearch,
} from '@/services/terminology/terminologyService';
import * as db from '@/services/terminology/cie10SpanishDatabase';
import * as ai from '@/services/terminology/cie10AISearch';
import * as cache from '@/services/terminology/aiResultsCache';

vi.mock('@/services/terminology/cie10SpanishDatabase', () => ({
  searchCIE10: vi.fn(),
  getCIE10DatabaseSync: vi.fn(() => [
    { code: 'E11', description: 'Diabetes', category: 'Endocrino' },
    { code: 'J44', description: 'EPOC', category: 'Resp' },
    { code: 'I10', description: 'Hipertensión esencial', category: 'Cardiovascular' },
  ]),
}));

vi.mock('@/services/terminology/cie10AISearch', () => ({
  searchCIE10WithAI: vi.fn(),
}));

vi.mock('@/services/terminology/aiResultsCache', () => ({
  getCachedAIResults: vi.fn(),
  cacheAIResults: vi.fn(),
}));

describe('Servicio de Terminología CIE-10 (terminologyService)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── searchDiagnoses: búsqueda principal por defecto ──
  describe('searchDiagnoses() — Búsqueda automática (local + caché)', () => {
    it('retorna [] si la consulta tiene menos de 2 caracteres', async () => {
      const results = await searchDiagnoses('a');
      expect(results).toEqual([]);
      expect(db.searchCIE10).not.toHaveBeenCalled();
    });

    it('retorna resultados locales cuando no hay caché IA', async () => {
      const mockEntry = { code: 'E11', description: 'Diabetes', category: 'Endocrino' };
      vi.mocked(db.searchCIE10).mockResolvedValue([mockEntry]);
      vi.mocked(cache.getCachedAIResults).mockReturnValue(null);

      const results = await searchDiagnoses('diabetes');

      expect(db.searchCIE10).toHaveBeenCalledWith('diabetes');
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        code: 'E11',
        display: 'Diabetes',
        fromAI: false,
        system: 'http://hl7.org/fhir/sid/icd-10',
      });
    });

    it('prioriza resultados IA cacheados SOBRE los locales, sin duplicados', async () => {
      const localEntry = { code: 'E11', description: 'Diabetes', category: 'Endocrino' };
      const aiEntry = {
        code: 'E11.5',
        description: 'Diabetes con complicaciones',
        category: 'Endocrino',
      };

      vi.mocked(db.searchCIE10).mockResolvedValue([localEntry]);
      vi.mocked(cache.getCachedAIResults).mockReturnValue([aiEntry]);

      const results = await searchDiagnoses('diabetes');

      // IA va primero, local después (si no es duplicado)
      expect(results).toHaveLength(2);
      expect(results[0].code).toBe('E11.5');
      expect(results[0].fromAI).toBe(true);
      expect(results[0].category).toContain('IA ⚡');
      expect(results[1].code).toBe('E11');
      expect(results[1].fromAI).toBe(false);
    });

    it('elimina duplicados cuando IA y local tienen el mismo código', async () => {
      const localEntry = { code: 'I10', description: 'Hipertensión', category: 'Cardiovascular' };
      const aiEntry = {
        code: 'I10',
        description: 'Hipertensión esencial',
        category: 'Cardiovascular',
      };

      vi.mocked(db.searchCIE10).mockResolvedValue([localEntry]);
      vi.mocked(cache.getCachedAIResults).mockReturnValue([aiEntry]);

      const results = await searchDiagnoses('hipertension');

      // Solo 1 resultado (no duplicado), la versión IA
      expect(results).toHaveLength(1);
      expect(results[0].fromAI).toBe(true);
    });
  });

  // ── getCIE10Description: lookup por código ──
  describe('getCIE10Description() — Búsqueda de descripción por código', () => {
    it('retorna la descripción para un código conocido: "E11" → "Diabetes"', () => {
      expect(getCIE10Description('E11')).toBe('Diabetes');
    });

    it('retorna null para un código desconocido: "XYZ" → null', () => {
      expect(getCIE10Description('XYZ')).toBeNull();
    });

    it('retorna null para código vacío: "" → null', () => {
      expect(getCIE10Description('')).toBeNull();
    });
  });

  // ── forceAISearch: búsqueda bajo demanda con Gemini ──
  describe('forceAISearch() — Búsqueda IA bajo demanda (botón "IA")', () => {
    it('llama a Gemini, guarda en caché y retorna resultados fusionados', async () => {
      const aiEntry = { code: 'I10', description: 'HTA', category: 'Cardio' };
      vi.mocked(db.searchCIE10).mockResolvedValue([]);
      vi.mocked(ai.searchCIE10WithAI).mockResolvedValue([aiEntry]);

      const results = await forceAISearch('hta');

      // Verifica que llamó a la API de IA con la query
      expect(ai.searchCIE10WithAI).toHaveBeenCalledWith('hta', undefined);
      // Verifica que guardó en caché para no repetir tokens
      expect(cache.cacheAIResults).toHaveBeenCalledWith('hta', [aiEntry]);
      // Verifica resultado
      expect(results).toHaveLength(1);
      expect(results[0].fromAI).toBe(true);
      expect(results[0].category).toContain('IA 🔄');
    });

    it('fusiona IA + local sin duplicados cuando ambos retornan resultados', async () => {
      const localEntry = { code: 'E11', description: 'Diabetes', category: 'Endocrino' };
      const aiEntry = {
        code: 'E11.65',
        description: 'Diabetes hiperglucemia',
        category: 'Endocrino',
      };

      vi.mocked(db.searchCIE10).mockResolvedValue([localEntry]);
      vi.mocked(ai.searchCIE10WithAI).mockResolvedValue([aiEntry]);

      const results = await forceAISearch('diabetes');

      expect(results).toHaveLength(2);
      expect(results[0].fromAI).toBe(true); // IA va primero
      expect(results[1].fromAI).toBe(false); // Local después
    });

    it('maneja errores de IA graciosamente retornando []', async () => {
      vi.mocked(db.searchCIE10).mockResolvedValue([]);
      vi.mocked(ai.searchCIE10WithAI).mockRejectedValue(new Error('429 Too Many Requests'));

      const results = await forceAISearch('hta');
      expect(results).toEqual([]);
    });

    it('retorna solo local si IA retorna 0 resultados', async () => {
      const localEntry = { code: 'I10', description: 'Hipertensión', category: 'Cardio' };
      vi.mocked(db.searchCIE10).mockResolvedValue([localEntry]);
      vi.mocked(ai.searchCIE10WithAI).mockResolvedValue([]);

      const results = await forceAISearch('hipertension');

      expect(results).toHaveLength(1);
      expect(results[0].fromAI).toBe(false);
      // No cachea si IA retorna vacío
      expect(cache.cacheAIResults).not.toHaveBeenCalled();
    });
  });
  it('does not cache an AI response that completes after cancellation', async () => {
    const controller = new AbortController();
    vi.mocked(db.searchCIE10).mockResolvedValue([]);
    vi.mocked(ai.searchCIE10WithAI).mockImplementationOnce(async () => {
      controller.abort();
      return [{ code: 'I10', description: 'Synthetic' }];
    });
    await expect(forceAISearch('synthetic', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(cache.cacheAIResults).not.toHaveBeenCalled();
  });
});
