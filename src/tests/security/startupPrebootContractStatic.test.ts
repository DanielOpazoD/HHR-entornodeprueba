import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../');
const INDEX_HTML_PATH = path.join(ROOT, 'index.html');
const STARTUP_SURFACE_PATH = path.join(ROOT, 'public/startup-surface.js');
const LOGIN_IMAGE_DIR = path.join(ROOT, 'public/images/login');

const readIndexHtml = () => readFileSync(INDEX_HTML_PATH, 'utf8');
const readStartupSurface = () => readFileSync(STARTUP_SURFACE_PATH, 'utf8');

describe('Startup preboot contract', () => {
  it('keeps the startup surface contract in index.html without recreating the app chrome', () => {
    const html = readIndexHtml();

    expect(html).toContain('Startup UX contract:');
    expect(html).toContain('modulo origen desde React bootstrap');
    expect(html).toContain('document.documentElement.dataset.prebootSurface =');
    expect(html).toContain('APP_SURFACE_BACKGROUND');
    expect(html).toContain("size: '100% 56px, 100% 44px, 100% calc(100vh - 100px)'");
    expect(html).toContain('html[data-preboot-surface="app"] body');
  });

  it('does not preload development source modules from production index.html', () => {
    const html = readIndexHtml();

    expect(html).not.toContain("appendModulePreload('/src/App.tsx');");
    expect(html).not.toContain("appendModulePreload('/src/features/census/public-components.ts');");
    expect(html).not.toContain('rel="modulepreload"][href="/src/');
  });

  it('does not reintroduce a handcrafted census bar or forbidden startup copy in index.html', () => {
    const html = readIndexHtml();

    expect(html).not.toContain('id="preboot-census-chrome"');
    expect(html).not.toContain('document.documentElement.dataset.prebootChrome');
    expect(html).not.toContain('MutationObserver');
    expect(html).not.toContain('Enviar censo');
    expect(html).not.toContain('Preparando acceso seguro');
    expect(html).not.toContain('data-testid="default-loading-screen"');
    expect(html).not.toContain('data-testid="login-loading-shell"');
  });

  it('does not use the login image surface for authenticated module deep links without a session hint', () => {
    const script = readStartupSurface();

    expect(script).toContain(
      'var shouldUseLoginSurface = isLoginSurfacePath && !hasAnySessionHint;'
    );
    expect(script).not.toContain('|| !hasAnySessionHint');
  });

  it('uses the optimized login background asset in the preboot surface', () => {
    const script = readStartupSurface();

    expect(script).toContain("url('/images/login/hhr-login-day.webp')");
    expect(script).not.toContain("url('/images/login/hhr-login-day.png')");
  });

  it('keeps legacy PNG login backgrounds out of deployable public assets', () => {
    expect(existsSync(path.join(LOGIN_IMAGE_DIR, 'hhr-login-day.png'))).toBe(false);
    expect(existsSync(path.join(LOGIN_IMAGE_DIR, 'hhr-login-night.png'))).toBe(false);
    expect(existsSync(path.join(LOGIN_IMAGE_DIR, 'hhr-login-day.webp'))).toBe(true);
    expect(existsSync(path.join(LOGIN_IMAGE_DIR, 'hhr-login-night.webp'))).toBe(true);
  });
});
