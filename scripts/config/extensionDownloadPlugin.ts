import path from 'node:path';
import { extensionDirectory, packageRayenExtension } from '@hhr/eloisa-extension/package';
export { packageRayenExtension } from '@hhr/eloisa-extension/package';
import type { Plugin } from 'vite';

const MODULE_ID = 'virtual:rayen-extension-release';
const sourceDirectory = path.resolve(extensionDirectory);

/** One artifact/metadata pair for Vite dev, preview and Netlify's static dist. */
export function extensionDownloadPlugin(_root: string): Plugin {
  let artifact: ReturnType<typeof packageRayenExtension> | undefined;
  const getArtifact = () => (artifact ??= packageRayenExtension(path.dirname(sourceDirectory)));
  return {
    name: 'rayen-extension-download',
    resolveId(id) {
      if (id === MODULE_ID) return `\0${MODULE_ID}`;
    },
    load(id) {
      if (id !== `\0${MODULE_ID}`) return;
      const { version, fileName, buildId } = getArtifact();
      return `export default ${JSON.stringify({ version, path: fileName, buildId, notesUrl: `https://github.com/DanielOpazoD/extensioneloisahhr/releases/tag/v${version}` })};`;
    },
    configureServer(server) {
      server.watcher.add(sourceDirectory);
      server.watcher.on('all', (_event, file) => {
        if (file.startsWith(sourceDirectory + path.sep)) void server.restart();
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
