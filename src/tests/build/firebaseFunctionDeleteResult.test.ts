import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isFirebaseFunctionAlreadyAbsent } from '../../../scripts/check-firebase-function-delete-result.mjs';

describe('Firebase retired function deletion', () => {
  it('accepts the real Firebase CLI response when retired functions are already absent', () => {
    const output =
      '\u001b[31mError:\u001b[39m The specified filters do not match any existing functions in project hhr-pruebas.';

    expect(isFirebaseFunctionAlreadyAbsent(output)).toBe(true);
  });

  it.each([
    'No matching functions were found.',
    'Function mirrorDailyRecords was not found.',
    'Function mirrorClinicalDocuments does not exist.',
  ])('accepts a scoped function-absence response: %s', output => {
    expect(isFirebaseFunctionAlreadyAbsent(output)).toBe(true);
  });

  it.each([
    'Error: HTTP 403 while deleting function mirrorDailyRecords: permission denied.',
    'Error: Project hhr-pruebas was not found.',
    'Error: Network request failed while deleting function mirrorDailyRecords.',
    'Error: HTTP 403 permission denied. The specified filters do not match any existing functions.',
  ])('rejects an unrelated deletion failure: %s', output => {
    expect(isFirebaseFunctionAlreadyAbsent(output)).toBe(false);
  });

  it('keeps the workflow classifier fail-closed instead of matching generic errors inline', () => {
    const workflow = readFileSync(
      path.join(process.cwd(), '.github/workflows/deploy-functions.yml'),
      'utf8'
    );

    expect(workflow).toContain('node scripts/check-firebase-function-delete-result.mjs');
    expect(workflow).not.toContain("grep -Eiq 'not found|does not exist|no function'");
  });
});
