import type { CudyrReportDataset, CudyrReportRow } from '@/types/domain/cudyrReport';
import type { CudyrSupplementReport } from '@/types/domain/cudyrSupplement';
import { composeRayenGivenNames, normalizeOptionalPersonName } from '@/utils/eloisaPersonName';
import { isValidRut } from '@/utils/rutUtils';
import { cudyrDocumentKey, cudyrNameKey } from '@/domain/cudyr/cudyrSourceIdentity';

const words = (value: string) => cudyrNameKey(value).replace(/\*/g, '').trim().split(/\s+/);
export const cudyrOrderedIdentity = (document: string, name: string) =>
  JSON.stringify([
    cudyrDocumentKey(document),
    cudyrNameKey(name)
      .split(/[^A-Z0-9Ñ]+/)
      .filter(Boolean)
      .join(' '),
  ]);
const normalizedGiven = (value: string) => cudyrNameKey(composeRayenGivenNames(value));
/** Name words without Eloísa's administrative tokens, placeholders or punctuation. */
const nameWords = (value: string) =>
  cudyrNameKey(composeRayenGivenNames(value))
    .replace(/\b(?:NO\s*REFIERE|NO\s*INFORMAD[OA]?|SIN\s+INFORMACION)\b/g, ' ')
    .split(/[^A-Z0-9Ñ]+/)
    .filter(Boolean);
const isNewborn = (value: string) =>
  /^(RN\b|RECIEN NACID[OA]\b|PACIENTE NN\b)/.test(cudyrNameKey(value));

/** Only census-supported corrections. Surnames retain their order and spelling;
 * spaces may differ within the complete given names, but no letters are dropped.
 */
export const cudyrMatchesCensusName = (name: string, row: CudyrReportRow) => {
  if (!row.firstName || !row.lastName || isNewborn(name) || isNewborn(row.patientName))
    return false;
  const second = normalizeOptionalPersonName(row.secondLastName);
  const surnames = words([row.lastName, second].filter(Boolean).join(' '));
  const source = words(name);
  if (!second && /^(NO\s*INFORMAD[OA]?|SIN INFORMACION)$/.test(source.slice(-2).join(' ')))
    source.splice(-2);
  else if (!second && !normalizeOptionalPersonName(source.at(-1))) source.pop();
  if (source.length <= surnames.length) return false;
  const family = surnames.join(' ');
  // Some reports print surname block first. Only move the entire ordered block;
  // never sort individual name/surname words or exchange their meaning.
  const sourceGiven =
    source.slice(-surnames.length).join(' ') === family
      ? source.slice(0, -surnames.length)
      : source.slice(0, surnames.length).join(' ') === family
        ? source.slice(surnames.length)
        : null;
  if (!sourceGiven) return false;
  // In surname-first layouts the absent optional surname sits before the given names.
  if (!second && source.slice(0, surnames.length).join(' ') === family) {
    if (sourceGiven.length > 2 && !normalizeOptionalPersonName(sourceGiven.slice(0, 2).join(' ')))
      sourceGiven.splice(0, 2);
    else if (sourceGiven.length > 1 && !normalizeOptionalPersonName(sourceGiven[0]))
      sourceGiven.splice(0, 1);
  }
  const given = normalizedGiven(sourceGiven.join(' '));
  const expected = normalizedGiven(row.firstName);
  return Boolean(given && expected && given.replace(/ /g, '') === expected.replace(/ /g, ''));
};

/** One spelling in every report version: the census-supported rule that predates versions. */
const keepsOneSpelling = (name: string, census: CudyrReportRow) => {
  const [firstGiven] = normalizedGiven(census.firstName).split(' ');
  return (
    cudyrMatchesCensusName(name, census) ||
    (Boolean(firstGiven) &&
      normalizedGiven(name)
        .split(/[^A-Z0-9]+/)
        .includes(firstGiven))
  );
};

/** Eloísa may drop words or add placeholders between versions, but every word of every
 * spelling must belong to the census name, and each spelling keeps the census first given
 * name and the whole first surname: another person sharing a mistyped RUN stays apart.
 */
const joinsChangedSpellings = (sourceNames: string[], census: CudyrReportRow) => {
  const censusWords = new Set(
    nameWords(
      [census.firstName, census.lastName, normalizeOptionalPersonName(census.secondLastName)]
        .filter(Boolean)
        .join(' ')
    )
  );
  const [firstGiven] = nameWords(census.firstName || '');
  const firstSurname = nameWords(census.lastName || '');
  if (!firstGiven || !firstSurname.length) return false;
  return sourceNames.every(name => {
    const spelling = nameWords(name);
    return (
      spelling.includes(firstGiven) &&
      firstSurname.every(word => spelling.includes(word)) &&
      spelling.every(word => censusWords.has(word))
    );
  });
};

/** An alias is enabled only when every archived/census identity sharing this document
 * agrees with one structured census name. Never uses score, bed, fuzzy distance or an empty RUT.
 * The original names/documents remain untouched; episode/day ambiguity is handled downstream.
 */
export const createCudyrIdentityResolver = (
  data: CudyrReportDataset,
  reports: CudyrSupplementReport[]
): typeof cudyrOrderedIdentity => {
  const aliases = new Map<string, string>();
  const rowsByDocument = new Map<string, CudyrReportRow[]>();
  for (const row of data.rows) {
    const document = cudyrDocumentKey(row.rut);
    if (!document || row.contextSource === 'eloisa_monthly_report') continue;
    rowsByDocument.set(document, [...(rowsByDocument.get(document) || []), row]);
  }
  const sourcesByDocument = new Map<string, string[]>();
  // Two spellings inside one report version are two source rows (e.g. mother and newborn);
  // a spelling that changes only between versions is Eloísa rewriting the same person.
  const sharedInOneReport = new Set<string>();
  for (const report of reports) {
    const inReport = new Map<string, string>();
    for (const patient of report.patients) {
      const document = cudyrDocumentKey(patient.document);
      if (!document) continue;
      sourcesByDocument.set(document, [
        ...(sourcesByDocument.get(document) || []),
        patient.patientName,
      ]);
      const identity = cudyrOrderedIdentity(document, patient.patientName);
      if ((inReport.get(document) ?? identity) !== identity) sharedInOneReport.add(document);
      inReport.set(document, identity);
    }
  }
  for (const [document, rows] of rowsByDocument) {
    const sourceNames = sourcesByDocument.get(document);
    if (!sourceNames || rows.some(r => !r.clinicalEpisodeId)) continue;
    // A validated, non-shared RUN is the primary identifier. Keep RN/maternal documents
    // separate and require one census episode. The downstream day linker still checks ownership.
    const [census] = rows;
    const oneSpelling =
      new Set(sourceNames.map(name => cudyrOrderedIdentity(document, name))).size === 1;
    if (
      isValidRut(document) &&
      !rows.some(r => r.documentType === 'Pasaporte') &&
      new Set(rows.map(r => r.clinicalEpisodeId)).size === 1 &&
      !rows.some(r => r.modality === 'cuna' || isNewborn(r.patientName)) &&
      !sourceNames.some(isNewborn) &&
      !sharedInOneReport.has(document) &&
      census &&
      (oneSpelling
        ? sourceNames.every(name => keepsOneSpelling(name, census))
        : joinsChangedSpellings(sourceNames, census))
    ) {
      const canonical = JSON.stringify([document, 'RUN']);
      for (const name of [...rows.map(r => r.patientName), ...sourceNames])
        aliases.set(cudyrOrderedIdentity(document, name), canonical);
      continue;
    }
    const names = [...new Set([...rows.map(r => r.patientName), ...sourceNames])];
    if (new Set(names.map(name => cudyrOrderedIdentity(document, name))).size < 2) continue;
    // Every census row must agree internally AND with the same structured identity.
    if (rows.some(row => !cudyrMatchesCensusName(row.patientName, row))) continue;
    const signatures = new Set(
      rows.map(row =>
        JSON.stringify([
          normalizedGiven(row.firstName).replace(/ /g, ''),
          cudyrNameKey(row.lastName),
          cudyrNameKey(normalizeOptionalPersonName(row.secondLastName)),
        ])
      )
    );
    if (signatures.size !== 1) continue;
    const anchors = rows.filter(row => names.every(name => cudyrMatchesCensusName(name, row)));
    if (!anchors.length) continue;
    const canonical = anchors
      .map(r =>
        cudyrOrderedIdentity(
          document,
          [
            composeRayenGivenNames(r.firstName),
            r.lastName,
            normalizeOptionalPersonName(r.secondLastName),
          ]
            .filter(Boolean)
            .join(' ')
        )
      )
      .sort()[0];
    for (const name of names) aliases.set(cudyrOrderedIdentity(document, name), canonical);
  }
  // Pure per (document, name): projections ask for the same pair once per row and source cell.
  const known = new Map<string, Map<string, string>>();
  return (document, name) => {
    const byName = known.get(document) || new Map<string, string>();
    known.set(document, byName);
    let identity = byName.get(name);
    if (identity === undefined) {
      const ordered = cudyrOrderedIdentity(document, name);
      identity = aliases.get(ordered) || ordered;
      byName.set(name, identity);
    }
    return identity;
  };
};
