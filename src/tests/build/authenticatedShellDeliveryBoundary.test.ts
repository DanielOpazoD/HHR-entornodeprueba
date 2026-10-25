// @vitest-environment node
import path from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const absolute = (file: string) => path.resolve(file);

const bundleDelivery = async (entries: string[], modules: string[]) => {
  const ownedModules = new Set(
    [...entries, ...modules].map(file => absolute(file).replace(/\.tsx?$/, ''))
  );
  const result = await build({
    configFile: false,
    envDir: false,
    logLevel: 'silent',
    resolve: { alias: { '@': absolute('src') } },
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: entries.map(absolute),
        preserveEntrySignatures: 'strict',
        output: {
          manualChunks: id =>
            entries.some(entry => absolute(entry) === id) ? 'app-authenticated-shell' : undefined,
        },
        external: id => {
          const resolved = id.startsWith('@/') ? absolute(`src/${id.slice(2)}`) : id;
          return !ownedModules.has(resolved.replace(/\.tsx?$/, ''));
        },
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap(output => ('output' in output ? output.output : []))
    .filter(output => output.type === 'chunk');
  const startup = new Set<string>();
  const visit = (name: string) => {
    if (startup.has(name)) return;
    startup.add(name);
    chunks.find(chunk => chunk.fileName === name)?.imports.forEach(visit);
  };
  chunks.filter(chunk => chunk.isEntry).forEach(chunk => visit(chunk.fileName));
  return {
    allModules: chunks.flatMap(chunk => chunk.moduleIds),
    startupModules: chunks
      .filter(chunk => startup.has(chunk.fileName))
      .flatMap(chunk => chunk.moduleIds),
  };
};

describe('authenticated shell delivery boundaries', () => {
  it('loads the WhatsApp transport only when sending, outside the startup graph', async () => {
    const transport = 'src/services/integrations/whatsapp/whatsappService.ts';
    const graph = await bundleDelivery(
      ['src/application/handoff/sendMedicalHandoffUseCase.ts'],
      [transport]
    );
    expect(graph.allModules).toContain(absolute(transport));
    expect(graph.startupModules).not.toContain(absolute(transport));
  });

  it('keeps recipient state pure and loads the remote service through the existing lazy use case', async () => {
    const service = 'src/services/email/emailRecipientListService.ts';
    const graph = await bundleDelivery(
      [
        'src/hooks/useCensusEmailRecipientRuntimeState.ts',
        'src/hooks/controllers/censusEmailRecipientSelectionController.ts',
        'src/hooks/controllers/censusEmailRecipientListController.ts',
        'src/hooks/controllers/censusEmailRecipientSyncController.ts',
        'src/hooks/controllers/censusEmailRecipientUseCaseLoader.ts',
      ],
      [
        service,
        'src/services/email/emailRecipientListSupport.ts',
        'src/application/census-email/censusRecipientListUseCases.ts',
        'src/hooks/controllers/censusEmailRecipientsBootstrapController.ts',
      ]
    );
    expect(graph.allModules).toContain(absolute(service));
    expect(graph.startupModules).not.toContain(absolute(service));
  });
});
