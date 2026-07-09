/**
 * Maps a Rayen bed/room/service location to an HHR `bedId`.
 *
 * Confirmed mapping (see PLAN-SINCRONIZACION.md §2.2–2.3):
 *   Real service "Área Médico Quirúrgica Indiferenciada":
 *     Habitacion N / C{n}  → H{N}C{n}      (general, MEDIA)
 *     Recuperacion k / R{k} → R{k}          (UTI)
 *     Neo k / Neo{k}        → NEO{k}         (MEDIA)
 *   Virtual CMA service "Área quirúrgica indiferenciada" (codes CMA*):
 *     CMA R{k} / CMAR{k}    → R{k}   (same physical bed, isCma=true)
 *     CMA NEO{k} / CMAN{k}  → NEO{k} (same physical bed, isCma=true)
 *
 * CMA is a *discharge type*, not a distinct location: a CMA patient occupies the
 * same real bed; `isCma` only flags that the eventual discharge is a CMA discharge.
 */

/** Reason the bed was resolved — useful for diagnostics and preview UI. */
export type BedMatchKind = 'general' | 'recovery' | 'neo' | 'none';

export interface BedMappingResult {
  /** HHR `bedId`, or `null` if the location could not be mapped. */
  bedId: string | null;
  /** True when the source is the CMA (ambulatory surgery) virtual service. */
  isCma: boolean;
  /** How the mapping was resolved. */
  matchedBy: BedMatchKind;
}

/**
 * Fold accents, uppercase, then strip everything but A–Z/0–9. Rayen sends accented
 * Spanish labels ("Área quirúrgica indiferenciada", "Habitación 3", "Recuperación 1"),
 * so we must decompose (NFD) and drop the combining marks BEFORE removing non-ASCII —
 * otherwise "QUIRÚRGICA" → "QUIRRGICA" and would never match "QUIRURGICA".
 */
const normalize = (value?: string): string =>
  (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** True when the service name is the virtual CMA area (and not the real médico-quirúrgica one). */
const isCmaService = (serviceNorm: string): boolean =>
  serviceNorm.includes('QUIRURGICAINDIFERENCIADA') && !serviceNorm.includes('MEDICO');

export interface RayenBedLocation {
  room?: string;
  bed?: string;
  service?: string;
}

export const mapRayenBed = (location: RayenBedLocation): BedMappingResult => {
  const roomRaw = normalize(location.room);
  const bedRaw = normalize(location.bed);
  const serviceNorm = normalize(location.service);

  const isCma = roomRaw.startsWith('CMA') || bedRaw.startsWith('CMA') || isCmaService(serviceNorm);

  // Strip the CMA prefix so the underlying physical bed can be matched.
  const room = roomRaw.replace(/^CMA/, '');
  const bed = bedRaw.replace(/^CMA/, '');

  const fail = (matchedBy: BedMatchKind = 'none'): BedMappingResult => ({
    bedId: null,
    isCma,
    matchedBy,
  });
  const ok = (bedId: string, matchedBy: BedMatchKind): BedMappingResult => ({
    bedId,
    isCma,
    matchedBy,
  });

  // Recovery / UTI: R1–R4 (bed code "R1", room "Rk" or "Recuperacion k").
  let m = /^R([1-4])$/.exec(bed) || /^R([1-4])$/.exec(room) || /RECUPERACION0*([1-4])$/.exec(room);
  if (m) return ok(`R${m[1]}`, 'recovery');

  // Neonatology: NEO1/NEO2 (bed code "N1"/"NEO1", room "NEO1"/"Neo k").
  m = /^N(?:EO)?([12])$/.exec(bed) || /^N(?:EO)?([12])$/.exec(room) || /NEO0*([12])$/.exec(room);
  if (m) return ok(`NEO${m[1]}`, 'neo');

  // General: room H{N} + bed C{n} → H{N}C{n}; also accept combined "H{N}C{n}" or "Habitacion N".
  const roomHab = /^H([1-6])$/.exec(room) || /HABITACION0*([1-6])$/.exec(room);
  const bedCol = /^C([12])$/.exec(bed);
  if (roomHab && bedCol) return ok(`H${roomHab[1]}C${bedCol[1]}`, 'general');

  const combined = /^H([1-6])C([12])$/.exec(room) || /^H([1-6])C([12])$/.exec(bed);
  if (combined) return ok(`H${combined[1]}C${combined[2]}`, 'general');

  return fail();
};
