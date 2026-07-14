import { describe, expect, it } from 'vitest';
import { mapRayenBed } from '@/features/rayen-import';
import { isCmaLocation } from '@/features/rayen-import/mapping/bedMapping';

describe('isCmaLocation', () => {
  it('recognizes a stored CMA location (virtual service or "CMA R#/NEO#" bed token)', () => {
    expect(isCmaLocation('Área quirúrgica indiferenciada / CMA R1 / CMA R1')).toBe(true);
    expect(isCmaLocation('Área quirúrgica indiferenciada / CMA NEO2 / CMANEO2')).toBe(true);
  });

  it('is false for the real médico-quirúrgica service and plain physical beds', () => {
    expect(isCmaLocation('Área Médico Quirúrgica Indiferenciada / Habitación 1 / H1C1')).toBe(
      false
    );
    expect(isCmaLocation('Recuperación 2 / R2')).toBe(false);
    expect(isCmaLocation('')).toBe(false);
    expect(isCmaLocation(undefined)).toBe(false);
  });
});

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

  it('detects CMA from the accented service name alone, without a CMA-prefixed bed', () => {
    // Real flow: a CMA patient occupies a physical bed (no "CMA" prefix on room/bed);
    // only the virtual service name marks the discharge as CMA. This regressed silently
    // when normalize() dropped the accents in "quirúrgica" (QUIRÚRGICA → QUIRRGICA).
    const result = mapRayenBed({
      room: 'R2',
      service: 'Área quirúrgica indiferenciada',
    });
    expect(result.isCma).toBe(true);
    expect(result.bedId).toBe('R2');
  });

  it('matches accented room long-forms (Habitación / Recuperación)', () => {
    expect(mapRayenBed({ room: 'Habitación 3', bed: 'C2' }).bedId).toBe('H3C2');
    expect(mapRayenBed({ room: 'Recuperación 4' }).bedId).toBe('R4');
  });

  it('returns null bedId for unmappable locations', () => {
    expect(mapRayenBed({ room: 'X', bed: 'Y' })).toEqual({
      bedId: null,
      isCma: false,
      matchedBy: 'none',
    });
  });
});
