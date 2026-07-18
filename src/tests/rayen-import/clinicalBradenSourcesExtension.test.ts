// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const backgroundSource = readFileSync(
  new URL('../../../extension/background.js', import.meta.url),
  'utf8'
);
const contentSource = [
  '../../../extension/content-prescription-print.js',
  '../../../extension/hhr-handoff-scores-center.js',
]
  .map(file => readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n');

const sliceBetween = (startMarker: string, endMarker: string) => {
  const start = backgroundSource.indexOf(startMarker);
  const end = backgroundSource.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`No se encontró ${startMarker}.`);
  return backgroundSource.slice(start, end);
};

describe('extension BRADEN source reconciliation', () => {
  it('always reads history and forms for the integrated regimen PDF', () => {
    const source = sliceBetween(
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
      'const handleScoresOptionsRequest = async',
      'const readScoresBatch = async'
    );

    expect(source).toContain('fetchScaleHistoryEvents(patient.encounterId, info, 120)');
    expect(source).toContain('fetchEvaluationForms(patient.encounterId, info)');
    expect(source).toContain("forms.error ? [] : forms.forms,\n      'BRADEN'");
    expect(source).toContain("forms.error ? [] : forms.forms,\n      'DOWNTON'");
    expect(source).toContain('BRADEN: evaluationReadErrors ? [] : bradenHistory.slice(0, 8)');
    expect(source).toContain('DOWNTON: evaluationReadErrors ? [] : downtonHistory.slice(0, 8)');
    expect(source).not.toContain('if (!bradenHistory.length || !downtonHistory.length)');
  });

  it('does not render or enable registration from a partial scale read', () => {
    expect(contentSource).toMatch(/const history = unavailableReason\s*\?\s*\[\]/);
    expect(contentSource).toContain('if (!unavailableReason && history.length)');
    expect(contentSource).toContain(
      'action.disabled = !canWriteInstrument || Boolean(uncertainWrite) || Boolean(unavailableReason)'
    );
  });

  it('fails closed when any required form source is unavailable', () => {
    const source = sliceBetween(
      'const fetchEvaluationForms = async',
      'const fetchScaleHistoryEvents = async'
    );

    expect(source).toContain('const failures = results.filter(result => result.error)');
    expect(source).toContain('if (failures.length)');
    expect(source).not.toContain('const successful = results.filter');
  });

  it('uses the same two-source read for an ambiguous BRADEN or Downton recovery', () => {
    const source = sliceBetween(
      'const readClinicalWriteRecoveryReview = async',
      "const PRESCRIPTION_BATCH_PREFIX = 'hhr-prescription-batch-'"
    );

    expect(source).toContain('fetchScaleHistoryEvents(encId, info, 120)');
    expect(source).toContain('fetchEvaluationForms(encId, info)');
    expect(source).toContain('history.error || forms.error');
  });
});
