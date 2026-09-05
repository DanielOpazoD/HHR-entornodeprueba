import fs from 'node:fs';
import { expect, it } from 'vitest';
import {
  collectArtifactDownloads,
  collectArtifactUploads,
  collectTransitiveNeeds,
  parseWorkflowJobs,
} from '../../../scripts/ciArtifactContractSupport.mjs';

it('runs Lighthouse against the validated dist from the same workflow without rebuilding', () => {
  const jobs = parseWorkflowJobs(fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8'));
  const lighthouse = jobs.get('lighthouse-ci');
  const downloads = collectArtifactDownloads(jobs).filter(job => job.jobName === 'lighthouse-ci');
  const uploads = collectArtifactUploads(jobs).filter(artifact => artifact.name === 'dist');

  expect(lighthouse).toBeDefined();
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toMatchObject({ jobName: 'build', path: 'dist/' });
  expect(collectTransitiveNeeds(jobs, 'lighthouse-ci')).toContain('build');
  expect(downloads).toHaveLength(1);
  expect(downloads[0]).toMatchObject({ name: 'dist', path: 'dist' });
  expect(downloads[0].block).not.toMatch(/\b(?:run-id|repository|artifact-ids):/);
  expect(lighthouse!.body.indexOf('name: dist')).toBeLessThan(
    lighthouse!.body.indexOf('uses: treosh/lighthouse-ci-action@')
  );
  expect(lighthouse!.body).not.toContain('npm run build');
  expect(lighthouse!.body).not.toContain('continue-on-error: true');
  expect(lighthouse!.body).toContain('run: npm ci');
  expect(lighthouse!.body).toContain('configPath: ./lighthouserc.json');
  expect(lighthouse!.body).toContain('uploadArtifacts: true');

  const config = JSON.parse(fs.readFileSync('lighthouserc.json', 'utf8'));
  expect(config.ci.collect.numberOfRuns).toBe(3);
  expect(config.ci.collect.startServerCommand).toBe(
    'npm run preview -- --port 4173 --host 127.0.0.1'
  );
});

it('recognizes Vite readiness with plain or ANSI-colored output, but not startup chatter', () => {
  const config = JSON.parse(fs.readFileSync('lighthouserc.json', 'utf8'));
  const readyPattern = new RegExp(config.ci.collect.startServerReadyPattern, 'i');

  // Vite inserts an ANSI reset between "Local" and ":" in GitHub Actions.
  for (const output of [
    '  ➜  Local:   http://127.0.0.1:4173/',
    '  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://127.0.0.1:\u001b[1m4173\u001b[22m/',
    '  Local\u001b[0m\u001b[39m:   http://127.0.0.1:4173/',
  ]) {
    expect(readyPattern.test(output)).toBe(true);
  }

  for (const output of [
    '',
    '> vite preview --port 4173 --host 127.0.0.1',
    'Error: Local server failed to start',
  ]) {
    expect(readyPattern.test(output)).toBe(false);
  }
});
