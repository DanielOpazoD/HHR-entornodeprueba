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
