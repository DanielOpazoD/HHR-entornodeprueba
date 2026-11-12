// @vitest-environment node
import path from 'node:path';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const eslint = new ESLint({ cwd: path.resolve(__dirname, '../../../') });
const messages = async (filePath: string, code: string) =>
  (await eslint.lintText(code, { filePath }))[0].messages.filter(m =>
    m.message.includes('puerto de aplicación')
  );
const forms = [
  (p: string) => `import { x } from '${p}';`,
  (p: string) => `import('${p}');`,
  (p: string) => `export * from '${p}';`,
  (p: string) => `export { x } from '${p}';`,
  (p: string) => `require('${p}');`,
];
for (const [index, form] of forms.entries()) {
  it(`enforces port access for syntax ${index}`, async () => {
    for (const file of [
      'src/features/census/Probe.ts',
      'src/hooks/Probe.ts',
      'src/components/Probe.ts',
      'src/application/Probe.ts',
    ]) {
      for (const module of [
        'repositories/ClinicalDocumentRepository',
        'integrations/censusEmailService',
      ]) {
        const relative = path.posix.relative(path.posix.dirname(file), `src/services/${module}`);
        for (const target of [`@/services/${module}`, `${relative}.ts`])
          expect(await messages(file, form(target))).toHaveLength(1);
      }
      expect(await messages(file, form('@/application/ports/clinicalDocumentPort'))).toEqual([]);
    }
    for (const file of [
      'src/application/ports/Probe.ts',
      'src/hooks/controllers/Probe.ts',
      'src/features/backup/Probe.ts',
      'src/services/Probe.ts',
      'src/features/census/Probe.test.ts',
      'src/features/census/Probe.spec.ts',
      'src/features/census/Probe.stories.ts',
      'src/features/census/Probe.d.ts',
    ])
      expect(
        await messages(file, form('@/services/repositories/ClinicalDocumentRepository'))
      ).toEqual([]);
  });
}
