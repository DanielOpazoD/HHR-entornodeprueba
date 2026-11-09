import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, type Zippable } from 'fflate';
import type { Plugin } from 'vite';

const MODULE_ID = 'virtual:rayen-extension-release';

/** Package runtime code plus explicitly declared assets, never arbitrary local files. */
export function packageRayenExtension(root: string) {
  const directory = path.join(root, 'extension');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  // Derived metadata must never survive a source edit or change the input fingerprint.
  delete manifest.version_name;
  const files = new Set<string>([
    'manifest.json',
    'vendor-lock.json',
    ...fs.readdirSync(directory).filter(name => /^(?!\.)[\w.-]+\.(?:js|mjs|html|css)$/.test(name)),
    ...manifest.web_accessible_resources.flatMap(
      (group: { resources: string[] }) => group.resources
    ),
  ]);
  const entries: Zippable = {};
  const identity = createHash('sha256');
  for (const name of [...files].sort()) {
    if (!/^[\w./-]+$/.test(name) || name.split('/').some(part => part === '..' || part === '.')) {
      throw new Error(`Unsafe extension package path: ${name}`);
    }
    const file = path.join(directory, name);
    if (
      path.isAbsolute(name) ||
      !fs.realpathSync(file).startsWith(`${fs.realpathSync(directory)}${path.sep}`)
    ) {
      throw new Error(`Extension package file escapes its source directory: ${name}`);
    }
    const bytes =
      name === 'manifest.json'
        ? Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
        : fs.readFileSync(file);
    identity.update(JSON.stringify([name, bytes.length]) + '\n').update(bytes);
    entries[name] = [bytes, { mtime: new Date(2020, 0, 1) }];
  }
  const buildId = identity.digest('hex');
  entries['manifest.json'] = [
    Buffer.from(
      JSON.stringify(
        { ...manifest, version_name: `${manifest.version}+hhr1.${buildId}` },
        null,
        2
      ) + '\n'
    ),
    { mtime: new Date(2020, 0, 1) },
  ];
  const zip = zipSync(entries, { level: 6 });
  const fileName = `downloads/eloisa-extension-${manifest.version}-${buildId.slice(0, 12)}.zip`;
  return { zip, fileName, version: manifest.version as string, buildId };
}

/** One artifact/metadata pair for Vite dev, preview and Netlify's static dist. */
export function extensionDownloadPlugin(root: string): Plugin {
  let artifact: ReturnType<typeof packageRayenExtension> | undefined;
  const getArtifact = () => (artifact ??= packageRayenExtension(root));
  return {
    name: 'rayen-extension-download',
    resolveId(id) {
      if (id === MODULE_ID) return `\0${MODULE_ID}`;
    },
    load(id) {
      if (id !== `\0${MODULE_ID}`) return;
      const { version, fileName, buildId } = getArtifact();
      return `export default ${JSON.stringify({ version, path: fileName, buildId })};`;
    },
    configureServer(server) {
      server.watcher.add(path.join(root, 'extension'));
      server.watcher.on('all', (_event, file) => {
        if (file.startsWith(path.join(root, 'extension') + path.sep)) void server.restart();
      });
      server.middlewares.use((req, res, next) => {
        const { zip, fileName } = getArtifact();
        if (req.url?.split('?')[0] !== `${server.config.base}${fileName}`) return next();
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(fileName)}"`);
        res.setHeader('Content-Length', zip.length);
        res.end(req.method === 'HEAD' ? undefined : zip);
      });
    },
    generateBundle() {
      const { zip, fileName } = getArtifact();
      this.emitFile({ type: 'asset', fileName, source: zip });
    },
  };
}
