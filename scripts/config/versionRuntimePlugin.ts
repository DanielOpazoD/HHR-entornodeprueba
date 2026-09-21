import type { Plugin, ViteDevServer } from 'vite';

export interface VersionInfo {
  version: string;
  buildDate: string;
}

interface VersionResponse {
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

const VERSION_ASSET = 'version.json';
const VERSION_ROUTE = `/${VERSION_ASSET}`;

export const serializeVersionInfo = (versionInfo: VersionInfo): string =>
  JSON.stringify(versionInfo, null, 2);

export const writeVersionResponse = (response: VersionResponse, versionInfo: VersionInfo): void => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(serializeVersionInfo(versionInfo));
};

/** Serve one version identity in development and emit that identity in builds. */
export const versionRuntimePlugin = (versionInfo: VersionInfo): Plugin => ({
  name: 'version-runtime',
  buildStart() {
    console.log(`[versionRuntimePlugin] Prepared version.json: ${versionInfo.version}`);
  },
  configureServer(server: ViteDevServer) {
    server.middlewares.use(VERSION_ROUTE, (_request, response) => {
      writeVersionResponse(response, versionInfo);
    });
  },
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: VERSION_ASSET,
      source: serializeVersionInfo(versionInfo),
    });
  },
});
