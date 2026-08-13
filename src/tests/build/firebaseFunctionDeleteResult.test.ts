import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isFirebaseFunctionAlreadyAbsent } from '../../../scripts/check-firebase-function-delete-result.mjs';

describe('Firebase retired function deletion', () => {
  it('accepts the real Firebase CLI response when retired functions are already absent', () => {
    const output = [
      'npm notice New minor version of npm available! 11.5.1 -> 11.6.0',
      'npm warn deprecated node-domexception@1.0.0: Use your platform native DOMException instead',
      'npm warn deprecated uuid@9.0.1: package no longer supported',
      '\u001b[31mError:\u001b[39m The specified filters do not match any existing functions in project hhr-pruebas.',
    ].join('\n');

    expect(isFirebaseFunctionAlreadyAbsent(output)).toBe(true);
  });

  it.each([
    'No matching functions were found.',
    'Function mirrorDailyRecords was not found.',
    'Function mirrorClinicalDocuments does not exist.',
    'The specified filters do not match any existing functions in project example-403.',
  ])('accepts a scoped function-absence response: %s', output => {
    expect(isFirebaseFunctionAlreadyAbsent(output)).toBe(true);
  });

  it.each([
    'Error: HTTP 403 while deleting function mirrorDailyRecords: permission denied.',
    'Error: request failed with status code 401.',
    'Error: Project hhr-pruebas was not found.',
    'Error: Network request failed while deleting function mirrorDailyRecords.',
    'Error: HTTP 403 permission denied. The specified filters do not match any existing functions.',
    [
      'Error: HTTP 403 permission denied.',
      'Error: The specified filters do not match any existing functions in project hhr-pruebas.',
    ].join('\n'),
    [
      'Error: HTTP 500 while deleting function mirrorDailyRecords.',
      'Error: The specified filters do not match any existing functions in project hhr-pruebas.',
    ].join('\n'),
    [
      'Unexpected Firebase CLI failure.',
      'Error: The specified filters do not match any existing functions in project hhr-pruebas.',
    ].join('\n'),
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

  it('redeploys functions when a deployment helper changes', () => {
    const workflow = readFileSync(
      path.join(process.cwd(), '.github/workflows/deploy-functions.yml'),
      'utf8'
    );

    expect(workflow).toContain("- 'scripts/check-deployed-firebase-functions.mjs'");
    expect(workflow).toContain("- 'scripts/check-firebase-function-delete-result.mjs'");
    expect(workflow).toContain("- 'scripts/list-firebase-function-targets.mjs'");
  });
});
