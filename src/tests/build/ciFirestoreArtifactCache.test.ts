// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import {
  prepareEmulatorArtifact,
  verifyEmulatorArtifact,
} from '../../../scripts/setup-firestore-emulator-cache.mjs';
import { parseWorkflow } from './workflowYamlTestSupport';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
const fixture = (content = Buffer.from('pinned emulator')) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-emulator-cache-'));
  roots.push(root);
  const details = {
    downloadPath: path.join(root, 'firestore.jar'),
    opts: {
      expectedSize: content.length,
      expectedChecksum: crypto.createHash('md5').update(content).digest('hex'),
      expectedChecksumSHA256: crypto.createHash('sha256').update(content).digest('hex'),
      skipChecksumAndSize: false,
    },
  };
  return { content, details };
};

it('reuses valid bytes without downloading or trusting a cache-hit flag', async () => {
  const { content, details } = fixture();
  fs.writeFileSync(details.downloadPath, content);
  const download = vi.fn();
  expect(await prepareEmulatorArtifact({ details, download })).toBe('verified-cache');
  expect(download).not.toHaveBeenCalled();
});
it.each(['missing', 'truncated', 'same-size corruption'])(
  'repairs %s cache bytes with a verified download',
  async kind => {
    const { content, details } = fixture();
    if (kind !== 'missing')
      fs.writeFileSync(
        details.downloadPath,
        kind === 'truncated' ? content.subarray(1) : Buffer.alloc(content.length)
      );
    expect(await verifyEmulatorArtifact(details)).toBe(false);
    const download = vi.fn(() => fs.writeFileSync(details.downloadPath, content));
    expect(await prepareEmulatorArtifact({ details, download })).toBe('verified-download');
    expect(download).toHaveBeenCalledOnce();
    expect(await verifyEmulatorArtifact(details)).toBe(true);
  }
);
it('rejects wrong SHA-256 even when size and MD5 match', async () => {
  const { content, details } = fixture();
  fs.writeFileSync(details.downloadPath, content);
  details.opts.expectedChecksumSHA256 = 'f'.repeat(64);
  expect(await verifyEmulatorArtifact(details)).toBe(false);
});
it('preserves leading-zero digest values used by Firebase metadata', async () => {
  let content = Buffer.from('candidate-0');
  let index = 0;
  while (!crypto.createHash('sha256').update(content).digest('hex').startsWith('0'))
    content = Buffer.from(`candidate-${++index}`);
  const { details } = fixture(content);
  details.opts.expectedChecksumSHA256 = details.opts.expectedChecksumSHA256.replace(/^0+/, '');
  fs.writeFileSync(details.downloadPath, content);
  expect(await verifyEmulatorArtifact(details)).toBe(true);
});
it.each(['skip-verification', 'missing-sha256', 'missing-md5', 'invalid-size'])(
  'rejects unpinned metadata: %s',
  async kind => {
    const { details } = fixture();
    if (kind === 'skip-verification') details.opts.skipChecksumAndSize = true;
    if (kind === 'missing-sha256') details.opts.expectedChecksumSHA256 = '';
    if (kind === 'missing-md5') details.opts.expectedChecksum = '';
    if (kind === 'invalid-size') details.opts.expectedSize = 0;
    const download = vi.fn();
    await expect(prepareEmulatorArtifact({ details, download })).rejects.toThrow('pinned');
    expect(download).not.toHaveBeenCalled();
  }
);
it('fails if downloading throws or returns invalid bytes', async () => {
  const { details } = fixture();
  await expect(
    prepareEmulatorArtifact({
      details,
      download: () => {
        throw Error('download failed');
      },
    })
  ).rejects.toThrow('download failed');
  await expect(
    prepareEmulatorArtifact({
      details,
      download: () => fs.writeFileSync(details.downloadPath, 'wrong'),
    })
  ).rejects.toThrow('integrity verification');
});
it('replaces symlinks without changing their target', async () => {
  const { content, details } = fixture();
  const target = `${details.downloadPath}.external`;
  fs.writeFileSync(target, content);
  fs.symlinkSync(target, details.downloadPath);
  expect(await verifyEmulatorArtifact(details)).toBe(false);
  await prepareEmulatorArtifact({
    details,
    download: () => fs.writeFileSync(details.downloadPath, content),
  });
  expect(fs.lstatSync(details.downloadPath).isSymbolicLink()).toBe(false);
  expect(fs.readFileSync(target)).toEqual(content);
});
it('verifies artifacts before saving and keeps the full emulator suites', () => {
  const action = parse(
    fs.readFileSync('.github/actions/setup-ci-firestore-emulator/action.yml', 'utf8')
  );
  const steps = action.runs.steps;
  const restore = steps.find((step: { id?: string }) => step.id === 'artifact');
  const verify = steps.find(
    (step: { run?: string }) => step.run === 'node scripts/setup-firestore-emulator-cache.mjs'
  );
  const save = steps.find((step: { uses?: string }) =>
    step.uses?.startsWith('actions/cache/save@')
  );
  expect(restore.with).not.toHaveProperty('restore-keys');
  expect(restore.with.path).toBe('${{ steps.emulator.outputs.path }}');
  expect(verify).not.toHaveProperty('if');
  expect(verify['continue-on-error']).not.toBe(true);
  expect(steps.indexOf(save)).toBeGreaterThan(steps.indexOf(verify));
  const { jobs } = parseWorkflow(fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8'));
  for (const name of ['rules-emulator', 'e2e-critical-emulator']) {
    const jobSteps = jobs[name].steps;
    const cache = jobSteps.findIndex(
      step => step.uses === './.github/actions/setup-ci-firestore-emulator'
    );
    expect(cache).toBeGreaterThan(
      jobSteps.findIndex(step => step.uses === './.github/actions/setup-ci-dependencies')
    );
    expect(cache).toBeLessThan(
      jobSteps.findIndex(step => /npm run test:(?:rules:ci|e2e:critical:ci)/.test(step.run || ''))
    );
  }
  expect(
    jobs['rules-emulator'].steps.some(step => step.run === 'npm run test:emulator:sync:ci')
  ).toBe(true);
});
