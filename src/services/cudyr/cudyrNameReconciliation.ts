import type { CudyrReportDataset, CudyrReportRow } from '@/types/domain/cudyrReport';
import type { CudyrSupplementReport } from '@/types/domain/cudyrSupplement';
import { composeRayenGivenNames, normalizeOptionalPersonName } from '@/utils/eloisaPersonName';
import { isValidRut } from '@/utils/rutUtils';
import { cudyrDocumentKey, cudyrNameKey } from './cudyrSourceIdentity';

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
  for (const report of reports)
    for (const patient of report.patients) {
      const document = cudyrDocumentKey(patient.document);
      if (document)
        sourcesByDocument.set(document, [
          ...(sourcesByDocument.get(document) || []),
          patient.patientName,
        ]);
    }
  for (const [document, rows] of rowsByDocument) {
    const sourceNames = sourcesByDocument.get(document);
    if (!sourceNames || rows.some(r => !r.clinicalEpisodeId)) continue;
    // A validated, non-shared RUN is the primary identifier. Keep RN/maternal documents
    // separate and require one census episode; the downstream day linker still checks ownership.
    if (
      isValidRut(document) &&
      new Set(rows.map(r => r.clinicalEpisodeId)).size === 1 &&
      !rows.some(r => r.modality === 'cuna' || isNewborn(r.patientName)) &&
      !sourceNames.some(isNewborn) &&
      new Set(sourceNames.map(name => cudyrOrderedIdentity(document, name))).size === 1 &&
      sourceNames.every(
        name =>
          cudyrMatchesCensusName(name, rows[0]) ||
          normalizedGiven(name)
            .split(/[^A-Z0-9]+/)
            .includes(normalizedGiven(rows[0].firstName).split(' ')[0])
      )
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
  return (document, name) =>
    aliases.get(cudyrOrderedIdentity(document, name)) || cudyrOrderedIdentity(document, name);
};
