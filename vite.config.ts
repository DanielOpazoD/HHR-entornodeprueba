import fs from 'node:fs';
import path from 'path';
import { execFileSync } from 'node:child_process';
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import viteCompression from 'vite-plugin-compression';
import { VitePWA } from 'vite-plugin-pwa';
import { chunkForModule } from './scripts/config/chunkingPolicy';
import { minsalSharedInteropPlugin } from './scripts/config/minsalSharedInteropPlugin';
import { netlifyFunctionDevServerPlugin } from './scripts/config/netlifyFunctionDevServer';
import { bindReleaseEvidenceToBuild } from './scripts/config/releaseEvidenceRuntimeAsset';

/**
 * Generate version.json directly in the build output so the repo does not
 * accumulate tracked diffs on every build.
 */
function versionPlugin(versionInfo: { version: string; buildDate: string }): Plugin {
  return {
    name: 'version-plugin',
    buildStart() {
      console.log(`[versionPlugin] Prepared version.json: ${versionInfo.version}`);
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify(versionInfo, null, 2),
      });
    },
  };
}

const RELEASE_EVIDENCE_ASSET = 'release-evidence.json';
const RELEASE_EVIDENCE_SOURCE = path.resolve(
  __dirname,
  'reports',
  'release-evidence-runtime',
  RELEASE_EVIDENCE_ASSET
);

const unavailableReleaseEvidence = () =>
  JSON.stringify(
    {
      schemaVersion: 1,
      contractVersion: 1,
      generatedAt: null,
      gitSha: null,
      status: 'unavailable',
      summary: { decisionReports: 0, currentReports: 0, staleReports: 0 },
    },
    null,
    2
  );

const resolveBuildGitSha = () => {
  const environmentSha = process.env.COMMIT_REF || process.env.GITHUB_SHA;
  if (environmentSha) return environmentSha;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
};

const BUILD_GIT_SHA = resolveBuildGitSha();

const readReleaseEvidenceAsset = () =>
  fs.existsSync(RELEASE_EVIDENCE_SOURCE)
    ? bindReleaseEvidenceToBuild(
        fs.readFileSync(RELEASE_EVIDENCE_SOURCE, 'utf8'),
        BUILD_GIT_SHA,
        gitSha => {
          try {
            return execFileSync('git', ['rev-parse', `${gitSha}^{commit}`], {
              cwd: __dirname,
              encoding: 'utf8',
            }).trim();
          } catch {
            return '';
          }
        }
      )
    : unavailableReleaseEvidence();

/** Serve the same release contract in dev and in the production bundle. */
function releaseEvidenceRuntimePlugin(): Plugin {
  const route = `/${RELEASE_EVIDENCE_ASSET}`;
  return {
    name: 'release-evidence-runtime',
    configureServer(server) {
      server.middlewares.use(route, (req, res, next) => {
        if (req.url && req.url !== '/' && !req.url.startsWith('/?')) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        try {
          res.end(readReleaseEvidenceAsset());
        } catch {
          res.statusCode = 503;
          res.end(unavailableReleaseEvidence());
        }
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: RELEASE_EVIDENCE_ASSET,
        source: readReleaseEvidenceAsset(),
      });
    },
  };
}

function excelJsRuntimeAssetPlugin(): Plugin {
  const runtimeAssetPath = path.resolve(
    __dirname,
    'node_modules',
    'exceljs',
    'dist',
    'exceljs.bare.min.js'
  );
  const runtimeAssetRoute = '/vendor/exceljs.bare.min.js';

  return {
    name: 'exceljs-runtime-asset',
    configureServer(server) {
      server.middlewares.use(runtimeAssetRoute, (_req, res, next) => {
        try {
          const source = fs.readFileSync(runtimeAssetPath);
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.end(source);
        } catch (error) {
          next(error as Error);
        }
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'vendor/exceljs.bare.min.js',
        source: fs.readFileSync(runtimeAssetPath, 'utf8'),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';
  const isNetlifyLocalDev =
    process.env.NETLIFY_LOCAL === 'true' ||
    process.env.NETLIFY === 'true' ||
    process.env.CONTEXT === 'dev';
  const buildVersionInfo = {
    version: Date.now().toString(),
    buildDate: new Date().toISOString(),
  };

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      hmr: isNetlifyLocalDev ? false : undefined,
      // Mirror netlify.toml's Cross-Origin-Opener-Policy so Firebase Auth's
      // Google sign-in popup works on localhost. Without unsafe-none the dev
      // server leaves COOP at the browser default and Chrome blocks the
      // post-auth window.close() call, degrading popup sign-in (and the
      // Firestore session that depends on it). Dev-only; production sets this
      // same header via netlify.toml.
      headers: {
        'Cross-Origin-Opener-Policy': 'unsafe-none',
      },
      fs: {
        // Allow Vite to serve files (notably @fontsource .woff2 assets) when
        // node_modules is symlinked from a `.claude/worktrees/<name>/`
        // git-worktree to the parent project's install. The worktree sits
        // three levels deeper than the original project root; without this,
        // Vite returns 403 for any URL that resolves outside the worktree
        // via the symlink, which silently breaks font loading and falls
        // back to system serif. The added paths are dev-only and do not
        // affect production builds.
        allow: ['..', '../..', '../../..'],
      },
    },
    plugins: [
      versionPlugin(buildVersionInfo),
      releaseEvidenceRuntimePlugin(),
      excelJsRuntimeAssetPlugin(),
      netlifyFunctionDevServerPlugin(),
      minsalSharedInteropPlugin(__dirname),
      // plugin-react supports fastRefresh at runtime, but current bundled types
      // do not expose the option in this repo's version matrix.
      react({
        fastRefresh: !isNetlifyLocalDev,
      } as unknown as Parameters<typeof react>[0]),
      tailwindcss(),
      // PWA plugin configuration
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'service-worker.js',
        injectManifest: {
          swSrc: 'src/service-worker.ts',
          injectionPoint: 'self.__WB_MANIFEST',
          // Keep large optional references/runtime chunks out of install-time
          // precache. They remain available as normal on-demand assets, while
          // first-run PWA install stays focused on app shell/critical runtime.
          globIgnores: [
            '**/docs/**',
            '**/templates/**',
            '**/images/forms/**',
            '**/vendor/exceljs.bare.min.js',
            '**/assets/exceljs.min-*.js',
            '**/assets/pdf.worker-*.mjs',
            '**/assets/vendor-pdfjs-*.js',
            '**/assets/pdf-*.js',
            '**/assets/vendor-pdf-*.js',
            '**/assets/docxtemplater-*.js',
            '**/assets/LineChart-*.js',
            '**/assets/documentFallbacks-*.js',
            '**/assets/vendor-excel-*.js',
            '**/assets/vendor-canvas-*.js',
            '**/assets/terminologyService-*.js',
            '**/assets/fonasaDatabase-*.js',
            '**/assets/clinicalDocumentTemplateEditorController-*.js',
            '**/assets/vendor-heic2any-*.js',
            // Rayen enrichment only runs while Eloisa is connected, so it is
            // an on-demand online workflow rather than PWA install payload.
            '**/assets/applyClinicalEnrichmentBatch-*.js',
            '**/assets/applyHistoricalCudyr-*.js',
            '**/assets/clinicalFillRunner-*.js',
            '**/assets/clinicalEnrichmentBatchPayload-*.js',
            '**/assets/clinicalEnrichmentPersistenceStrategy-*.js',
            '**/assets/replanRayenStructure-*.js',
          ],
        },
        registerType: 'autoUpdate',
        injectRegister: 'script',
        manifest: {
          name: 'Hanga Roa Hospital Tracker',
          short_name: 'HHR',
          description: 'Sistema de gestión de censo hospitalario del Hospital Hanga Roa',
          theme_color: '#0284c7',
          background_color: '#f8fafc',
          display: 'standalone',
          icons: [
            {
              src: 'images/logos/logo_HHR.png', // Using existing logo as base
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'images/logos/logo_HHR.png',
              sizes: '512x512',
              type: 'image/png',
            },
          ],
        },
        devOptions: {
          enabled: false, // Disabling SW in dev to prevent source code caching/interfering
          type: 'module',
        },
      }),
      // Gzip compression for production builds
      isProduction &&
        viteCompression({
          algorithm: 'gzip',
          ext: '.gz',
          threshold: 10240, // Only compress files > 10KB
          verbose: false,
          deleteOriginFile: false,
        }),
      // Brotli compression (better ratio than gzip)
      isProduction &&
        viteCompression({
          algorithm: 'brotliCompress',
          ext: '.br',
          threshold: 10240,
          verbose: false,
          deleteOriginFile: false,
        }),
    ].filter(Boolean),
    define: {
      'import.meta.env.VITE_E2E_MODE': JSON.stringify(process.env.VITE_E2E_MODE || 'false'),
      __APP_BUILD_VERSION__: JSON.stringify(buildVersionInfo.version),
      __ENABLE_NODE_EXCEL_LOADER__: JSON.stringify(
        process.env.VITEST === 'true' || process.env.NODE_ENV === 'test'
      ),
    },
    build: {
      // Prefer true lazy loading over speculative preload for heavy feature chunks.
      // This keeps PDF/Excel vendors out of the critical bootstrap path.
      modulePreload: false,
      commonjsOptions: {
        include: [/node_modules/, /functions\/lib\/minsal\/.*\.js$/],
      },
      rollupOptions: {
        output: {
          manualChunks: chunkForModule,
        },
      },
      // Keep warnings actionable: remaining heavy chunks are monolithic vendor libraries
      // (three/exceljs) already isolated behind lazy-loaded feature paths.
      chunkSizeWarningLimit: 950,
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: isProduction,
          drop_debugger: isProduction,
          passes: isProduction ? 2 : 1,
          pure_funcs: isProduction ? ['console.log', 'console.debug'] : [],
        },
        mangle: {
          safari10: true,
        },
      },
      // Target modern browsers for smaller output
      target: 'es2022',
      // Enable source maps only in development
      sourcemap: !isProduction,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    // Optimize dependencies - pre-bundle CommonJS packages for ESM compatibility
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'motion/react',
        'firebase/app',
        'firebase/auth',
        'firebase/firestore',
      ],
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './tests/setup.ts',
    },
  };
});
