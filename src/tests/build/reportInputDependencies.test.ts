// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { EVIDENCE_DEPENDENCY_GRAPH } from '../../../scripts/evidenceDependencyGraph.mjs';
import { POST_MERGE_EVIDENCE_COMMANDS } from '../../../scripts/postMergeEvidenceSupport.mjs';

it('declares every observed report input, even when the input is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-inputs-'));
  try {
    // Read sources from this checkout; all generated outputs belong to the temporary root.
    for (const entry of fs.readdirSync(process.cwd())) {
      if (['reports', '.git', 'coverage', 'dist'].includes(entry)) continue;
      fs.symlinkSync(path.join(process.cwd(), entry), path.join(root, entry));
    }
    for (const args of [
      ['init', '-q'],
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        'Synthetic report inputs',
      ],
    ]) {
      expect(spawnSync('git', args, { cwd: root }).status).toBe(0);
    }
    const trace = path.join(root, 'trace.jsonl');
    const preload = path.join(root, 'trace.mjs');
    fs.writeFileSync(
      preload,
      `
      import fs from 'node:fs';
      import path from 'node:path';
      import { syncBuiltinESMExports } from 'node:module';
      import { fileURLToPath } from 'node:url';
      for (const method of ['existsSync', 'readFileSync']) {
        const original = fs[method];
        fs[method] = function(file, ...args) {
          const relative = path.relative(process.cwd(), file instanceof URL ? fileURLToPath(file) : String(file));
          // Provenance fingerprints traverse declared edges; only trace semantic consumers.
          if (relative.startsWith('reports/') && !new Error().stack.includes('evidenceProvenanceSupport.mjs')) {
            fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify(relative) + '\\n');
          }
          return original.call(this, file, ...args);
        };
      }
      syncBuiltinESMExports();
    `
    );
    const visited = new Set<string>();
    const order: string[] = [];
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const dependency of EVIDENCE_DEPENDENCY_GRAPH[id].dependencies) visit(dependency);
      order.push(id);
    };
    for (const id of Object.keys(EVIDENCE_DEPENDENCY_GRAPH)) visit(id);
    const issues: string[] = [];
    for (const id of order) {
      const node = EVIDENCE_DEPENDENCY_GRAPH[id];
      fs.writeFileSync(trace, '');
      // Exercise the report constructor, without rerunning coverage or nested refresh wrappers.
      const script = id === 'sync-convergence' ? 'sync-convergence-evidence' : id;
      const result = spawnSync(
        process.execPath,
        ['--import', preload, path.join(process.cwd(), `scripts/report-${script}.mjs`)],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 60_000,
        }
      );
      expect(result.status, `${id}: ${result.stderr}`).toBe(0);
      const inputs: string[] = [
        ...new Set<string>(
          fs
            .readFileSync(trace, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line))
        ),
      ];
      console.log(`${id}: ${inputs.join(', ') || '(no report inputs)'}`);
      for (const input of inputs) {
        const producer = Object.entries(EVIDENCE_DEPENDENCY_GRAPH).find(([, candidate]) =>
          candidate.artifacts.includes(input)
        )?.[0];
        if (producer && producer !== id) {
          if (!node.dependencies.includes(producer))
            issues.push(`${id} reads ${input}: declare dependency ${producer}`);
        } else if (producer !== id && !node.fileDependencies.includes(input)) {
          issues.push(`${id} reads external/local input ${input}: declare fileDependencies`);
        }
      }
    }
    expect(issues).toEqual([]);
    const commands = POST_MERGE_EVIDENCE_COMMANDS.map(step => step.name);
    for (const consumer of ['legacy-retirement-debt', 'operational-health']) {
      expect(commands.indexOf('compatibility-governance')).toBeLessThan(commands.indexOf(consumer));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 120_000);

it('runs documentation and legacy controls without preexisting generated reports', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-controls-'));
  try {
    for (const entry of fs.readdirSync(process.cwd())) {
      if (['reports', '.git', 'coverage', 'dist'].includes(entry)) continue;
      fs.symlinkSync(path.join(process.cwd(), entry), path.join(root, entry));
    }
    for (const command of [
      'check:docs-drift',
      'check:operational-runbooks',
      'check:legacy-retirement-debt',
    ]) {
      const result = spawnSync('npm', ['run', '-s', command], {
        cwd: root,
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(result.status, `${command}: ${result.stdout}\n${result.stderr}`).toBe(0);
    }
    const report = JSON.parse(
      fs.readFileSync(path.join(root, 'reports/operational-health.json'), 'utf8')
    );
    expect(report.compatibilityGovernance).not.toBeNull();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
