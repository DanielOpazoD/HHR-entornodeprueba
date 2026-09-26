import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci-cd.yml'), 'utf8');

describe('CI static group scheduling', () => {
  it('splits quality-static into governed groups while preserving an aggregate quality-static check', () => {
    expect(workflow).toContain('quality-static-governance-snapshots:');
    expect(workflow).toContain('quality-static-groups:');
    expect(workflow).toContain('quality-static-dependent-groups:');
    expect(workflow).toContain('name: quality-static-${{ matrix.group }}');
    const independentGroups = workflow.slice(
      workflow.indexOf('  quality-static-groups:'),
      workflow.indexOf('  quality-static-dependent-groups:')
    );
    const dependentGroups = workflow.slice(
      workflow.indexOf('  quality-static-dependent-groups:'),
      workflow.indexOf('  quality-static:')
    );
    expect(independentGroups).toContain('needs: [ci-scope]');
    expect(independentGroups).toContain("if: needs.ci-scope.outputs.scope == 'full'");
    expect(independentGroups).toContain('group: [boundaries, security, size, tests]');
    expect(dependentGroups).toContain('needs: [quality-static-governance-snapshots]');
    expect(dependentGroups).toContain('group: [governance, reports]');
    expect(workflow).toContain('run: npm run check:quality:group -- ${{ matrix.group }}');
    expect(workflow).toContain('quality-static:');
    expect(workflow).toContain(
      'needs: [quality-static-governance-snapshots, quality-static-groups, quality-static-dependent-groups]'
    );
    expect(workflow).toContain('Quality static gates passed');
    expect(workflow).toContain('name: quality-static-governance-snapshots');
    expect(workflow).toContain("if: matrix.group == 'governance'");
  });
});
