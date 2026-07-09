import { describe, expect, it } from 'vitest';
import { mapRayenBed } from '@/features/rayen-import';

describe('mapRayenBed', () => {
  it('maps general beds from room + bed short names (H{N} + C{n})', () => {
    expect(mapRayenBed({ room: 'H1', bed: 'C2' })).toEqual({
      bedId: 'H1C2',
      isCma: false,
      matchedBy: 'general',
    });
    expect(mapRayenBed({ room: 'H6', bed: 'C1' }).bedId).toBe('H6C1');
  });

  it('maps general beds from the "Habitacion N" long form', () => {
    expect(mapRayenBed({ room: 'Habitacion 3', bed: 'C2' }).bedId).toBe('H3C2');
  });

  it('maps recovery beds (Recuperacion / R{k}) to UTI R1–R4', () => {
    expect(mapRayenBed({ room: 'Recuperacion 1', bed: 'R1' })).toEqual({
      bedId: 'R1',
      isCma: false,
      matchedBy: 'recovery',
    });
    expect(mapRayenBed({ bed: 'R4' }).bedId).toBe('R4');
  });

  it('maps neonatology beds (Neo k / NEO{k})', () => {
    expect(mapRayenBed({ room: 'Neo 2', bed: 'Neo2' })).toEqual({
      bedId: 'NEO2',
      isCma: false,
      matchedBy: 'neo',
    });
  });

  it('maps CMA beds to the same physical bed and flags isCma', () => {
    expect(mapRayenBed({ room: 'CMA R1', bed: 'CMAR1' })).toEqual({
      bedId: 'R1',
      isCma: true,
      matchedBy: 'recovery',
    });
    expect(mapRayenBed({ bed: 'CMAN1' })).toEqual({
      bedId: 'NEO1',
      isCma: true,
      matchedBy: 'neo',
    });
  });

  it('detects CMA from the virtual service name', () => {
    const result = mapRayenBed({
      room: 'CMA R2',
      bed: 'CMAR2',
      service: 'Área quirúrgica indiferenciada',
    });
    expect(result.isCma).toBe(true);
    expect(result.bedId).toBe('R2');
  });

  it('does NOT flag the real "Área Médico Quirúrgica Indiferenciada" as CMA', () => {
    const result = mapRayenBed({
      room: 'H1',
      bed: 'C2',
      service: 'Área Médico Quirúrgica Indiferenciada',
    });
    expect(result.isCma).toBe(false);
    expect(result.bedId).toBe('H1C2');
  });

  it('returns null bedId for unmappable locations', () => {
    expect(mapRayenBed({ room: 'X', bed: 'Y' })).toEqual({
      bedId: null,
      isCma: false,
      matchedBy: 'none',
    });
  });
});
