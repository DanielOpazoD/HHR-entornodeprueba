// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const GUARD = path.resolve('scripts/check-source-patterns.mjs');
const roots: string[] = [];
const CONTROLLERS = 'src/features/census/controllers/';
const LAZY_VIEWS = 'src/views/LazyViews.ts';

/** Runs the guard on a synthetic repository made of `files`. */
const runGuard = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-source-patterns-'));
  roots.push(root);
  for (const [relativePath, content] of Object.entries({ 'src/keep.ts': '', ...files })) {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    writeFileSync(path.join(root, relativePath), content);
  }
  const result = spawnSync(process.execPath, [GUARD], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Each case failed the single-rule scanner this guard replaced (W13-A3) and must keep failing.
const rejected: Array<[rule: string, file: string, source: string]> = [
  ['legacy-staff', 'src/a.ts', 'const n = record.nurses;'],
  ['legacy-staff', 'src/a.ts', 'const n = record. nurseName;'],
  ['legacy-staff', 'src/features/x/a.stories.ts', 'const n = record.nurseName;'],
  ['legacy-staff', 'src/features/x/a.test.ts', 'const n = record.nurses;'],
  [
    'firestore-runtime',
    'src/features/x/a.stories.ts',
    "import '@/services/firebase-runtime/firestoreRuntime';",
  ],
  [
    'hook-tests-mock-ports',
    'src/tests/hooks/useCensusEmail.test.ts',
    "vi.mock('@/services/integrations/censusEmailService');",
  ],
  [
    'hook-tests-mock-ports',
    'src/tests/hooks/useExportManager.test.ts',
    'import { x } from "@/services/integrations/censusEmailService";',
  ],
  ['core-console', 'src/services/pdf/a.ts', 'console.warn("x");'],
  ['core-console', 'src/features/rayen-import/x/a.tsx', 'console.log ( 1 )'],
  ['lazy-view-entrypoints', LAZY_VIEWS, "lazy(() => import('@/features/census/internal/x'));"],
  ['lazy-view-entrypoints', LAZY_VIEWS, "lazy(() => import('@/features/whatsapp/internal/x'));"],
  ['lazy-view-entrypoints', LAZY_VIEWS, "lazy(() => import('@/features/census/public/deep'));"],
  [
    'lazy-view-entrypoints',
    LAZY_VIEWS,
    "lazy(() => import('@/features/census/census-view/deep'));",
  ],
  ['census-controller-browser', `${CONTROLLERS}a.ts`, 'window.scrollTo(0, 0);'],
  ['census-controller-browser', `${CONTROLLERS}a.ts`, 'globalThis.x;'],
  ['census-controller-browser', `${CONTROLLERS}a.ts`, 'localStorage;'],
  ['census-controller-browser', `${CONTROLLERS}a.ts`, 'document.title;'],
  ['census-controller-browser', `${CONTROLLERS}censusBrowserRuntimeAdapter.ts`, 'window.x;'],
  [
    'census-controller-default-runtime',
    `${CONTROLLERS}a.ts`,
    "import { defaultBrowserWindowRuntime } from '@/shared/runtime';",
  ],
  ['browser-runtime-adapter', 'src/a.ts', 'window.open(url);'],
  ['browser-runtime-adapter', 'src/a.ts', 'window.alert(x);'],
  ['browser-runtime-adapter', 'src/a.ts', 'window.location.reload();'],
  ['browser-runtime-adapter', 'src/tests/helpers/a.ts', 'navigator.clipboard;'],
  ['native-dialogs', 'src/a.ts', "if (confirm('¿Seguro?')) {}"],
  ['native-dialogs', 'src/a.ts', 'alert(`x`);'],
  ['native-dialogs', 'src/tests/helpers/a.ts', 'prompt("x");'],
  [
    'firestore-runtime',
    'src/a.ts',
    "import { db } from '@/services/firebase-runtime/firestoreRuntime';",
  ],
  ['firestore-runtime', 'src/a.ts', 'import "@/services/firebase-runtime/firestoreRuntime";'],
  ['legacy-permissions', 'src/a.ts', "import { can } from '@/utils/permissions';"],
  [
    'staff-role-copies',
    'src/features/census/components/TensSelector.tsx',
    'export const TensSelector: React.FC<Props> = () => null;',
  ],
  ['staff-role-copies', 'src/components/modals/a.tsx', 'function NurseManagerModal() {}'],
  // Review of #1748: function, arrow and class components named for one role.
  ['staff-role-copies', 'src/A.tsx', 'export function NurseX() {return <div/>}'],
  ['staff-role-copies', 'src/A.tsx', 'export const TensX = () => <div/>'],
  [
    'staff-role-copies',
    'src/A.tsx',
    'export class NurseX extends React.Component { render(){return <div/>} }',
  ],
  ['staff-role-copies', 'src/A.tsx', 'export const NurseX = React.memo((props: P) => null);'],
];

const accepted: Array<[why: string, file: string, source: string]> = [
  ['staff fields in schemas', 'src/schemas/a.ts', 'record.nurses;'],
  ['staff fields in tests', 'src/tests/a.test.ts', 'record.nurses;'],
  ['a longer staff field', 'src/a.ts', 'record.nursesShift;'],
  [
    'service mock in an unlisted test',
    'src/tests/hooks/other.test.ts',
    "vi.mock('@/services/integrations/censusEmailService');",
  ],
  ['console outside core folders', 'src/services/other/a.ts', 'console.warn("x");'],
  ['a sanctioned lazy subpath', LAZY_VIEWS, "lazy(() => import('@/features/census/census-view'));"],
  ["a feature's public entry", LAZY_VIEWS, "lazy(() => import('@/features/whatsapp/public'));"],
  [
    'the census adapter',
    `${CONTROLLERS}censusBrowserRuntimeAdapter.ts`,
    "import { defaultBrowserWindowRuntime } from '@/shared/runtime';",
  ],
  ['a census controller test', `${CONTROLLERS}a.test.ts`, 'window.x;'],
  ['the shared runtime', 'src/shared/runtime/a.ts', "window.open(url); alert('x');"],
  [
    'the census email runtime controller',
    'src/hooks/controllers/censusEmailBrowserRuntimeController.ts',
    'navigator.clipboard;',
  ],
  ['a test-named file', 'src/tests/a.test.ts', "window.open(url); alert('x');"],
  ['a member confirm', 'src/a.ts', "notify.confirm('x');"],
  ['the dialog hook', 'src/a.ts', "confirm({ title: 'x' });"],
  [
    'a Firestore wrapper',
    'src/services/storage/firestore/firestoreServiceRuntime.ts',
    "import { db } from '@/services/firebase-runtime/firestoreRuntime';",
  ],
  [
    'the access policy',
    'src/shared/access/operationalAccessPolicy.ts',
    "import { can } from '@/utils/permissions';",
  ],
  ['a role-named type', 'src/a.tsx', 'interface NurseSelectorProps {}'],
  ['a role component in a test', 'src/tests/a.test.tsx', 'const NurseSelector = () => null;'],
  ['a role helper in a .ts module', 'src/services/staff/a.ts', 'const NurseCatalog = [];'],
  // Review of #1748: data, text and types named for one role are not components.
  ['role-named data', 'src/A.tsx', 'export const NurseLabels = ["Enfermería"];'],
  [
    'a literal that quotes a component',
    'src/A.tsx',
    'export const help = "Ejemplo: function TensX()";',
  ],
  ['a role-named type alias', 'src/A.tsx', 'export type NurseSlot = string;'],
  ['a role component in a test file', 'src/tests/A.test.tsx', 'const NurseX = () => <div/>;'],
  ['ordinary text', 'src/A.tsx', 'export const help = "NurseX y TensX";'],
  ['a role-named error class', 'src/A.tsx', 'export class NurseError extends Error {}'],
];

describe('check-source-patterns', () => {
  it.each(rejected)('[%s] rejects %s: %s', (rule, file, source) => {
    const { status, output } = runGuard({ [file]: source });

    expect(status).toBe(1);
    expect(output).toContain(`[${rule}] `);
    expect(output).toContain(`- ${file}:1 → `);
  });

  it.each(accepted)('accepts %s', (_why, file, source) => {
    const { status, output } = runGuard({ [file]: source });

    expect(output).toContain('Source pattern checks passed');
    expect(status).toBe(0);
  });

  it('names the fix once per rule and the line of every match', () => {
    const { status, output } = runGuard({
      'src/a.ts': "export {};\nwindow.open(a);\nwindow.open(b);\nalert('x');\n",
    });

    expect(status).toBe(1);
    expect(
      output.match(/\[browser-runtime-adapter\] Pasa por defaultBrowserWindowRuntime/g)
    ).toHaveLength(1);
    expect(output).toContain('- src/a.ts:2 → window.open(');
    expect(output).toContain('- src/a.ts:3 → window.open(');
    expect(output).toContain('[native-dialogs] Usa useConfirmDialog');
    expect(output).toContain("- src/a.ts:4 → alert('");
  });
});
