// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

const writeFixtureWorkspace = (extraRunbookContent?: string) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operational-runbooks-check-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'functions'), { recursive: true });
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      scripts: {
        'report:operational-health': 'echo ok',
        'check:operational-runbooks': 'echo ok',
        'check:serverless-runtime-governance': 'echo ok',
        'check:netlify-functions-bundle': 'echo ok',
      },
    })
  );
  fs.writeFileSync(
    path.join(root, 'functions/package.json'),
    JSON.stringify({ scripts: { 'audit:legacy-viewer-alias': 'echo ok' } })
  );

  const docs: Record<string, string> = {
    'docs/RUNBOOK_SYNC_RESILIENCE.md':
      'reports/operational-health.md conflictos por contexto RUNBOOK_OPERATIONAL_BUDGETS.md',
    'docs/RUNBOOK_SUPPORT_OPERATIONS.md':
      'npm run report:operational-health\nnpm run check:operational-runbooks',
    'docs/RUNBOOK_OPERATIONAL_BUDGETS.md':
      'warningOldestPendingAgeMs criticalOldestPendingAgeMs reports/operational-health.md',
    'docs/RUNBOOK_NETLIFY_SERVERLESS_DEPLOY.md':
      'npm run check:serverless-runtime-governance\nnpm run check:netlify-functions-bundle\ndocs/SERVERLESS_SENSITIVE_CONTRACTS.md',
    'docs/RUNBOOK_AI_PROVIDER_OPERATIONS.md':
      'AI_PROVIDER GEMINI_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY DEEPSEEK_API_KEY',
    'docs/SERVERLESS_SENSITIVE_CONTRACTS.md': 'send-census-email cie10-ai-search',
    'docs/RUNBOOK_AUTH_ACCESS_INCIDENTS.md':
      extraRunbookContent ?? 'cd functions && npm run audit:legacy-viewer-alias',
  };
  for (const [relativePath, content] of Object.entries(docs)) {
    fs.writeFileSync(path.join(root, relativePath), content);
  }

  fs.writeFileSync(
    path.join(root, 'reports/operational-health.json'),
    JSON.stringify({
      systemHealth: {},
      syncQueue: {},
      syncDomainProfiles: [{ id: 'census' }],
      conflictContexts: [],
      localPersistence: {},
      frontendStartup: {},
      repositoryPerformance: {},
      runbooks: ['1', '2', '3', '4', '5', '6'],
    })
  );

  return root;
};

describe('check-operational-runbooks.mjs', () => {
  it('passes when every npm run command in runbooks exists in its matching package.json', () => {
    const root = writeFixtureWorkspace();
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/check-operational-runbooks.mjs')],
      { cwd: root, encoding: 'utf8' }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[operational-runbooks] OK');
  });

  it('fails naming the runbook and missing script when an incident runbook references a nonexistent npm command', () => {
    const root = writeFixtureWorkspace('npm run report:does-not-exist');
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/check-operational-runbooks.mjs')],
      { cwd: root, encoding: 'utf8' }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/RUNBOOK_AUTH_ACCESS_INCIDENTS.md');
    expect(result.stderr).toContain('npm run report:does-not-exist');
    expect(result.stderr).toContain('package.json');
  });
});
