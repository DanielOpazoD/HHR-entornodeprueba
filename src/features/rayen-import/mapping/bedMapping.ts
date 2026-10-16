import { BEDS, REGULAR_BEDS } from '@/constants/beds';

/**
 * Maps a Rayen bed/room/service location to an HHR `bedId`.
 *
 * Confirmed mapping (see PLAN-SINCRONIZACION.md §2.2–2.3):
 *   Real service "Área Médico Quirúrgica Indiferenciada":
 *     Habitacion N / C{n}  → H{N}C{n}      (general, MEDIA)
 *     Recuperacion k / R{k} → R{k}          (UTI)
 *     Neo k / Neo{k}        → NEO{k}         (MEDIA)
 *     B1UEA…B4UEA          → BOX1…BOX4     (Urgencias, occupied-only)
 *   Virtual CMA service "Área quirúrgica indiferenciada" (codes CMA*):
 *     CMA R{k} / CMAR{k}    → CMA_R{k}    (separate census assignment)
 *     CMA NEO{k} / CMAN{k}  → CMA_NEO{k}  (separate census assignment)
 *
 * The CMA source assignment remains distinct even while the ordinary bed is occupied.
 * It is shown only when occupied and never adds installed hospital capacity.
 */

/** Reason the bed was resolved — useful for diagnostics and preview UI. */
export type BedMatchKind =
  | 'general'
  | 'recovery'
  | 'neo'
  | 'urgency-box'
  | 'clinical-crib'
  | 'none';

export interface BedMappingResult {
  /** HHR `bedId`, or `null` if the location could not be mapped. */
  bedId: string | null;
  /** True when the source is the CMA (ambulatory surgery) virtual service. */
  isCma: boolean;
  /** True when the source location is an attached newborn crib. `bedId` is its parent HHR bed. */
  isClinicalCrib: boolean;
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

/**
 * Exact CMA bed labels exposed by Gestión de Camas/Eloísa. Separator and case variants are
 * accepted (`CMA R1`, `CMA-R1`, `CMAR1`), but a plain physical `R1`/`NEO1` never matches.
 * `CMAN1/2` is retained because older Rayen payloads use that short-name for `CMA NEO1/2`.
 */
export const isCmaBedLabel = (value?: string): boolean =>
  /^CMA(?:R[1-4]|N(?:EO)?[12]|H[1-6]C[12])$/.test(normalize(value));

/**
 * True when a stored HHR patient `location` ("service / room / bed", set at admission) is a CMA
 * virtual location — i.e. the patient is a CMA (ambulatory major surgery) case. Used to classify a
 * discharge as CMA even when the discharge itself carries no CMA signal (e.g. the patient vanished
 * from the census on a partial egreso, before the administrative egreso report lists them). Matches
 * the same rules as `mapRayenBed`: the CMA virtual service, or a "CMA R#/NEO#" bed token.
 */
export const isCmaLocation = (location?: string): boolean => {
  const value = location ?? '';
  return isCmaService(normalize(value)) || value.split('/').some(isCmaBedLabel);
};

export interface RayenBedLocation {
  room?: string;
  bed?: string;
  service?: string;
  clinicalCribParentBedId?: string;
}

// Cribs are dynamic children of physical beds, not a separate installed crib catalog.
export const CLINICAL_CRIB_PARENT_BEDS = new Set(REGULAR_BEDS.map(bed => bed.id));

export const mapRayenBed = (location: RayenBedLocation): BedMappingResult => {
  const roomRaw = normalize(location.room);
  const bedRaw = normalize(location.bed);
  const serviceNorm = normalize(location.service);

  const isCma =
    isCmaBedLabel(location.room) || isCmaBedLabel(location.bed) || isCmaService(serviceNorm);

  const verifiedCribParent = normalize(location.clinicalCribParentBedId);
  const clinicalCribParent = CLINICAL_CRIB_PARENT_BEDS.has(verifiedCribParent)
    ? verifiedCribParent
    : null;

  // Strip the CMA prefix so the underlying physical bed can be matched.
  const room = roomRaw.replace(/^CMA/, '');
  const bed = bedRaw.replace(/^CMA/, '');

  const fail = (matchedBy: BedMatchKind = 'none'): BedMappingResult => ({
    bedId: null,
    isCma,
    isClinicalCrib: false,
    matchedBy,
  });
  const ok = (
    bedId: string,
    matchedBy: BedMatchKind,
    isClinicalCrib = false
  ): BedMappingResult => ({
    bedId:
      isCma && !isClinicalCrib && CLINICAL_CRIB_PARENT_BEDS.has(bedId) ? `CMA_${bedId}` : bedId,
    isCma,
    isClinicalCrib,
    matchedBy,
  });

  if (clinicalCribParent) return ok(clinicalCribParent, 'clinical-crib', true);

  // Urgencias exposes B1UEA…B4UEA; preserve the existing BOX1…BOX4 storage keys.
  // Other views use BOX 1 UEA…BOX 4 UEA. These occupied-only source locations are
  // activated by occupied encounters, never advertised as available capacity.
  const urgencyBox =
    /^(?:B([1-4])UEA|BOX([1-4])(?:UEA)?)$/.exec(bed) ||
    /^(?:B([1-4])UEA|BOX([1-4])(?:UEA)?)$/.exec(room);
  if (urgencyBox) return ok(`BOX${urgencyBox[1] ?? urgencyBox[2]}`, 'urgency-box');

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

  const known = BEDS.find(
    entry => normalize(entry.id) === bedRaw || normalize(entry.id) === roomRaw
  );
  if (known) return ok(known.id, 'general');

  return fail();
};
