import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parseWorkflow } from './workflowYamlTestSupport';

const read = (file: string) => fs.readFileSync(file, 'utf8');
const isControl = (file: string) => /^scripts\/check-[^/]+\.mjs$/.test(file);

// These jobs run the aggregate that tooling-scope-gate repeats against the real repo.
const repeatedJobs = new Set([
  'ci-scope',
  'docs-scope-gate',
  'functions-scope-gate',
  'tooling-scope-gate',
  'ci-strict-summary',
  'quality-static-base',
  'quality-static-groups',
  'quality-static-dependent-groups',
]);

const repositoryScripts: Record<string, string> = JSON.parse(read('package.json')).scripts;

export const collectToolingExclusions = ({
  workflowText = read('.github/workflows/ci-cd.yml'),
  scripts = repositoryScripts,
} = {}) => {
  const excluded = new Set<string>();
  const visited = new Set<string>();
  const inspectFile = (file: string) => {
    file = path.normalize(file);
    if (isControl(file)) excluded.add(file);
    if (visited.has(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return;
    visited.add(file);
    const content = read(file);
    for (const imported of ts.preProcessFile(content).importedFiles) {
      const specifier = imported.fileName;
      const target = specifier.startsWith('.')
        ? path.join(path.dirname(file), specifier)
        : specifier.startsWith('@/')
          ? `src/${specifier.slice(2)}`
          : specifier;
      for (const candidate of [
        target,
        `${target}.ts`,
        `${target}.tsx`,
        `${target}.mjs`,
        `${target}/index.ts`,
      ]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          inspectFile(candidate);
          break;
        }
      }
    }
    // Follow shell/node entry points too, including commands assembled in support modules.
    inspectCommand(content);
  };
  const visitedScripts = new Set<string>();
  const inspectCommand = (command: string) => {
    for (const match of command.matchAll(/npm\s+(?:--prefix\s+[^\s]+\s+)?run\s+([\w:-]+)/g)) {
      const name = match[1];
      if (visitedScripts.has(name)) continue;
      visitedScripts.add(name);
      if (scripts[name]) inspectCommand(scripts[name]);
      if (scripts[`pre${name}`]) inspectCommand(scripts[`pre${name}`]);
      if (scripts[`post${name}`]) inspectCommand(scripts[`post${name}`]);
    }
    for (const match of command.matchAll(/\bscripts\/[\w./-]+\.(?:mjs|cjs|js|sh)\b/g)) {
      inspectFile(match[0]);
    }
  };
  const inspectWorkflow = (file: string, primary = false) => {
    const { jobs } = parseWorkflow(primary ? workflowText : read(file));
    for (const [name, job] of Object.entries(jobs)) {
      if (primary && repeatedJobs.has(name)) continue;
      if (job.uses?.startsWith('./')) inspectWorkflow(job.uses.slice(2));
      for (const step of job.steps) {
        if (step.run) {
          let commands = [step.run];
          for (const [key, values] of Object.entries(job.strategy?.matrix ?? {})) {
            commands = commands.flatMap(command =>
              values.map(value => command.replaceAll('${{ matrix.' + key + ' }}', String(value)))
            );
          }
          for (const command of commands) inspectCommand(command);
        }
        if (step.uses?.startsWith('./')) {
          const actionFile = path.join(step.uses, 'action.yml');
          if (fs.existsSync(actionFile)) inspectCommand(read(actionFile));
        }
      }
    }
  };
  inspectWorkflow('.github/workflows/ci-cd.yml', true);
  const walk = (directory: string) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'tests', '__tests__', 'dist', '.git'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:[cm]?[jt]sx?|sh)$/.test(file)) inspectFile(file);
    }
  };
  for (const directory of ['src', 'e2e', 'netlify', 'functions']) walk(directory);
  for (const file of fs.readdirSync('.')) {
    if (/^(?:vite|playwright).*\.ts$/.test(file)) inspectFile(file);
  }
  return [...excluded].sort();
};
