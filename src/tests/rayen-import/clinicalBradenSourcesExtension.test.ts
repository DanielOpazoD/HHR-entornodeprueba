// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const clinicalClientSource = readFileSync(
  new URL('../../../extension/fichamedico-clinical-client.js', import.meta.url),
  'utf8'
);
const clinicalScoreRuntimeSource = readFileSync(
  new URL('../../../extension/clinical-score-runtime.js', import.meta.url),
  'utf8'
);
const clinicalScoreWriteRuntimeSource = readFileSync(
  new URL('../../../extension/clinical-score-write-runtime.js', import.meta.url),
  'utf8'
);
const clinicalBatchPrintRuntimeSource = readFileSync(
  new URL('../../../extension/clinical-batch-print-runtime.js', import.meta.url),
  'utf8'
);
const scoresPresentationSource = readFileSync(
  new URL('../../../extension/hhr-scores-presentation.js', import.meta.url),
  'utf8'
);
const scoresCenterSource = readFileSync(
  new URL('../../../extension/hhr-scores-center.js', import.meta.url),
  'utf8'
);
const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`No se encontró ${startMarker}.`);
  return source.slice(start, end);
};

describe('extension BRADEN source reconciliation', () => {
  it('always reads history and forms for the integrated regimen PDF', () => {
    const source = sliceBetween(
      clinicalBatchPrintRuntimeSource,
      'const fetchHospitalizedRegimenSummaries = async',
      'const getActiveHospitalizedPatientsWithFallback = async'
    );

    expect(source).toContain('fetchBradenHistoryEvents(patient.encounterId, info)');
    expect(source).toContain('fetchEvaluationForms(patient.encounterId, info)');
    expect(source).toContain('deriveLatestBraden(');
    expect(source).not.toContain('if (!braden)');
  });

  it('always reconciles both sources in the global Scores table', () => {
    const source = sliceBetween(
      clinicalScoreRuntimeSource,
      'const handleScoresOptionsRequest = async',
      'const readScoresBatch = async'
    );

    expect(source).toContain('fetchScaleHistoryEvents(patient.encounterId, info, 120)');
    expect(source).toContain('fetchEvaluationForms(patient.encounterId, info)');
    expect(source).toMatch(/forms\.error \? \[\] : forms\.forms,\s*'BRADEN'/);
    expect(source).toMatch(/forms\.error \? \[\] : forms\.forms,\s*'DOWNTON'/);
    expect(source).toContain('BRADEN: evaluationReadErrors ? [] : bradenHistory.slice(0, 8)');
    expect(source).toContain('DOWNTON: evaluationReadErrors ? [] : downtonHistory.slice(0, 8)');
    expect(source).not.toContain('if (!bradenHistory.length || !downtonHistory.length)');
  });

  it('does not render or enable registration from a partial scale read', () => {
    expect(scoresPresentationSource).toContain('if (unavailableReason) return [];');
    expect(scoresPresentationSource).toContain(
      'disabled: !canWriteInstrument || Boolean(uncertainWrite) || Boolean(unavailableReason)'
    );
    expect(scoresCenterSource).toContain('scoresPresentation.buildPatientPresentation({');
    expect(scoresCenterSource).not.toContain('const history = unavailableReason');
  });

  it('fails closed when any required form source is unavailable', () => {
    const source = sliceBetween(
      clinicalClientSource,
      'const fetchEvaluationForms = async',
      'const fetchScaleHistoryEvents = async'
    );

    expect(source).toContain('const failures = results.filter(result => result.error)');
    expect(source).toContain('if (failures.length)');
    expect(source).not.toContain('const successful = results.filter');
  });

  it('uses the same two-source read for an ambiguous BRADEN or Downton recovery', () => {
    const source = sliceBetween(
      clinicalScoreWriteRuntimeSource,
      'const readRecoveryReview = async',
      'return Object.freeze({'
    );

    expect(source).toContain('fetchScaleHistoryEvents(encId, info, 120)');
    expect(source).toContain('fetchEvaluationForms(encId, info)');
    expect(source).toContain('history.error || forms.error');
  });
});
