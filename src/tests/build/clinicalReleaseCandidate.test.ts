// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectClinicalReleaseCandidateIssues } from '../../../scripts/clinicalReleaseSignoffSupport.mjs';

const checker = path.resolve('scripts/check-clinical-release-signoff.mjs');
let root: string;
let signoffPath: string;
let candidate: {
  version: number;
  releaseCandidate: string;
  signoffs: Array<{
    scenarioId: string;
    status: string;
    validatedBy: string;
    validatedAt: string;
    evidence: Array<{ type: string; reference: string }>;
  }>;
};
const writeCandidate = () => fs.writeFileSync(signoffPath, JSON.stringify(candidate));
const issues = () => collectClinicalReleaseCandidateIssues(root, { signoffPath });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'clinical-candidate-'));
  fs.mkdirSync(path.join(root, 'scripts/config'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'scripts/config/clinical-release-validation.json'),
    JSON.stringify({ version: 1, scenarios: [{ id: 'synthetic_scenario' }] })
  );
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'Synthetic candidate',
    ],
    { cwd: root }
  );
  signoffPath = path.join(root, '.git/clinical-signoff.json');
  candidate = {
    version: 1,
    releaseCandidate: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    signoffs: [
      {
        scenarioId: 'synthetic_scenario',
        status: 'passed',
        validatedBy: 'Synthetic reviewer',
        validatedAt: '2026-10-05T10:00:00Z',
        evidence: [{ type: 'manual_signoff', reference: 'synthetic-session-123' }],
      },
    ],
  };
  writeCandidate();
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('candidate-bound clinical signoff', () => {
  it('accepts the complete record only for the clean immutable candidate', () => {
    expect(issues()).toEqual([]);
    fs.writeFileSync(path.join(root, 'changed.txt'), 'uncommitted');
    expect(issues()).toContain('Candidate signoff requires a clean checkout.');
  });

  it.each(['codex/release-readiness-blocks', 'a'.repeat(40), 'abc123'])(
    'rejects another or ambiguous candidate: %s',
    sha => {
      candidate.releaseCandidate = sha;
      writeCandidate();
      expect(issues()).toContain(
        'Clinical signoff releaseCandidate must equal the full current HEAD SHA.'
      );
    }
  );

  it.each(['2026-02-30T10:00:00Z', 'not-a-date', '2026-10-06T10:00:00Z'])(
    'rejects invalid or future validation dates: %s',
    date => {
      candidate.signoffs[0].validatedAt = date;
      writeCandidate();
      expect(issues()).toContain(
        'synthetic_scenario requires a valid, non-future UTC validation timestamp.'
      );
    }
  );

  it('does not accept a copied placeholder or automated evidence as clinical approval', () => {
    candidate.signoffs[0].validatedBy = 'Dr. Nombre Apellido';
    candidate.signoffs[0].evidence[0].type = 'automated_regression';
    writeCandidate();
    expect(issues()).toEqual(
      expect.arrayContaining([
        'synthetic_scenario has a placeholder reviewer.',
        'synthetic_scenario requires manual_signoff evidence for this candidate.',
      ])
    );
  });

  it('keeps missing scenarios and pending clinical review blocking', () => {
    candidate.signoffs[0].status = 'pending_human_review';
    writeCandidate();
    expect(issues()).toContain(
      'synthetic_scenario is pending_human_review; release signoff requires passed.'
    );
    candidate.signoffs = [];
    writeCandidate();
    expect(issues()).toContain('Missing signoff entry for scenario synthetic_scenario.');
  });

  it('fails closed for missing or malformed candidate records', () => {
    fs.rmSync(signoffPath);
    expect(issues().length).toBeGreaterThan(0);
    fs.writeFileSync(signoffPath, '{broken');
    expect(issues()[0]).toContain('could not be validated');
  });

  it('requires a non-empty versioned scenario contract', () => {
    fs.writeFileSync(
      path.join(root, 'scripts/config/clinical-release-validation.json'),
      JSON.stringify({ version: 1, scenarios: [] })
    );
    expect(issues()).toContain(
      'Candidate signoff requires version 1 and a non-empty clinical scenario contract.'
    );
  });

  it('makes the CLI reject absent approval instead of falling back to historical signoffs', () => {
    const result = spawnSync(process.execPath, [checker], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CLINICAL_RELEASE_SIGNOFF_FILE: '' },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('historical signoffs do not approve this release');
  });
});
