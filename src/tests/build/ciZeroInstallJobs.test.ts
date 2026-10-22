// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { parseWorkflow } from './workflowYamlTestSupport';

const { jobs } = parseWorkflow(fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8'));
const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts as Record<
  string,
  string
>;

const installsDependencies = (job: (typeof jobs)[string]) =>
  job.steps.some(
    step =>
      step.uses === './.github/actions/setup-ci-dependencies' ||
      /\bnpm (?:ci|install)\b/.test(step.run ?? '')
  );

/** Node entry files behind `npm run <script>`, following `npm run` chains. */
const entryFiles = (script: string, seen = new Set<string>()): string[] => {
  if (seen.has(script)) return [];
  seen.add(script);
  const command = scripts[script] ?? '';
  return [
    ...[...command.matchAll(/\bnode\s+(scripts\/[\w./-]+\.mjs)/g)].map(match => match[1]),
    ...[...command.matchAll(/\bnpm run ([\w:.-]+)/g)].flatMap(match => entryFiles(match[1], seen)),
  ];
};

/** Bare package imports reachable from `file` through relative imports. */
const packageImports = (file: string, seen = new Set<string>()): string[] => {
  if (seen.has(file)) return [];
  seen.add(file);
  const source = fs.readFileSync(file, 'utf8');
  // Statements start a line, so specifiers quoted inside string literals do not count.
  return [
    ...source.matchAll(/^\s*(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm),
    ...source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].flatMap(([, specifier]) => {
    if (specifier.startsWith('.'))
      return packageImports(path.normalize(path.join(path.dirname(file), specifier)), seen);
    return specifier.startsWith('node:') ? [] : [`${file} -> ${specifier}`];
  });
};

it('keeps jobs that skip dependency installation on Node built-ins only', () => {
  const zeroInstallJobs = Object.entries(jobs).filter(
    ([, job]) =>
      job.steps.some(step => /\bnpm run\b/.test(step.run ?? '')) && !installsDependencies(job)
  );
  // unit-risk and ci-runtime-telemetry start fast because they never run npm ci.
  expect(zeroInstallJobs.map(([name]) => name)).toEqual(
    expect.arrayContaining(['unit-risk', 'ci-runtime-telemetry'])
  );

  for (const [name, job] of zeroInstallJobs) {
    const files = job.steps.flatMap(step =>
      [...(step.run ?? '').matchAll(/\bnpm run ([\w:.-]+)/g)].flatMap(match => entryFiles(match[1]))
    );
    expect(files.length, `${name} runs npm scripts backed by Node files`).toBeGreaterThan(0);
    expect(
      files.flatMap(file => packageImports(file)),
      name
    ).toEqual([]);
  }
});
