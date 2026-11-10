// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfiguredPlaywrightProjects } from '../../../playwright.config';

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('e2e browser policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    [undefined, ['chromium']],
    ['chromium,firefox,webkit', ['chromium', 'firefox', 'webkit']],
    ['firefox', ['firefox']],
  ])('uses the selected browsers in the effective config for %s', async (browsers, names) => {
    vi.stubEnv('E2E_BROWSERS', browsers);
    vi.resetModules();
    const { default: config } = await import('../../../playwright.config');

    expect(config.projects?.map(project => project.name)).toEqual(names);
    expect(config.projects?.map(project => project.use?.defaultBrowserType)).toEqual(names);
  });

  it('keeps generic Playwright runs Chromium-first and makes cross-browser opt-in', () => {
    expect(resolveConfiguredPlaywrightProjects().map(project => project.name)).toEqual([
      'chromium',
    ]);
    expect(
      resolveConfiguredPlaywrightProjects('chromium,firefox,webkit').map(project => project.name)
    ).toEqual(['chromium', 'firefox', 'webkit']);
  });

  it('fails fast when E2E_BROWSERS contains an unsupported browser name', () => {
    expect(() => resolveConfiguredPlaywrightProjects('chormium')).toThrow(
      /Unsupported E2E_BROWSERS value: chormium/i
    );
  });

  it('keeps the clinical visual release smoke covering refresh/login and Excel export entrypoints', () => {
    const visualSmokeSource = readSource('e2e/clinical-release-visual-smoke.spec.ts');

    expect(visualSmokeSource).toContain('clinical-release-cudyr');
    expect(visualSmokeSource).toContain('clinical-release-census-after-refresh');
    expect(visualSmokeSource).toContain('Más opciones del censo');
    expect(visualSmokeSource).toContain('CUDYR · control diario');
    expect(visualSmokeSource).toContain('verifyCensusExcelDownload');
    expect(visualSmokeSource).toContain('verifyCudyrExcelDownload');
    expect(visualSmokeSource).toContain('__HHR_DOWNLOAD_CAPTURE__');
    expect(visualSmokeSource).toMatch(/page\.reload/);
    expect(visualSmokeSource).toMatch(/excel mensual/i);
  });

  it('keeps the clinical visual release smoke covering authenticated utility and prescription surfaces', () => {
    const visualSmokeSource = readSource('e2e/clinical-release-visual-smoke.spec.ts');

    expect(visualSmokeSource).toContain('verifyUtilityMenuVisualSmoke');
    expect(visualSmokeSource).toContain('verifyAuditVisualSmoke');
    expect(visualSmokeSource).toContain('verifyPrescriptionUploadMobileVisualSmoke');
    expect(visualSmokeSource).toContain('clinical-release-utility-menu');
    expect(visualSmokeSource).toContain('clinical-release-audit');
    expect(visualSmokeSource).toContain('clinical-release-prescription-upload-mobile');
  });
});
