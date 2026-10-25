// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  assertFirstPaintLazyCoverage,
  type FirstPaintSource,
} from '../../../scripts/config/firstPaintLazyCoverage';

const sourceRoot = process.env.PWA_PRECACHE_SOURCE_ROOT || process.cwd();
const readTree = (directory: string): FirstPaintSource[] =>
  fs.readdirSync(path.join(sourceRoot, directory), { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory()
      ? readTree(file)
      : /\.tsx?$/.test(file)
        ? [{ file, source: fs.readFileSync(path.join(sourceRoot, file), 'utf8') }]
        : [];
  });
const sources = ['src/app-shell', 'src/components/layout', 'src/features/census'].flatMap(readTree);
sources.push({
  file: 'src/components/ui/FunctionsRecovery.tsx',
  source: fs.readFileSync(path.join(sourceRoot, 'src/components/ui/FunctionsRecovery.tsx'), 'utf8'),
});

it('classifies every lazy call and dynamic import in the first-paint trees', () => {
  expect(() => assertFirstPaintLazyCoverage(sources)).not.toThrow();
});

it.each([
  "const NewMount = lazy(() => import('./NewUnclassifiedMount'));",
  "const NewMount = lazyWithRetry(() => import('./NewUnclassifiedMount'));",
  "const loader = () => import('./NewUnclassifiedMount'); const NewMount = React.lazy(loader);",
  "void import('./NewUnclassifiedMount');",
  'const NewMount = lazy(() => Promise.resolve({default: ExistingComponent}));',
  'const NewMount = lazy(() => import(componentPath));',
])('fails closed when a new fixture adds an unclassified mount: %s', source => {
  expect(() =>
    assertFirstPaintLazyCoverage([
      ...sources,
      { file: 'src/features/census/components/Fixture.tsx', source },
    ])
  ).toThrow(/Unclassified first-paint lazy mounts/);
});
