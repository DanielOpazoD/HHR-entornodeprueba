import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfiguredPlaywrightProjects } from '../../../playwright.config';

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('e2e browser policy', () => {
  it('keeps generic Playwright runs Chromium-first and makes cross-browser opt-in', () => {
    const configSource = readSource('playwright.config.ts');

    expect(resolveConfiguredPlaywrightProjects().map(project => project.name)).toEqual([
      'chromium',
    ]);
    expect(
      resolveConfiguredPlaywrightProjects('chromium,firefox,webkit').map(project => project.name)
    ).toEqual(['chromium', 'firefox', 'webkit']);
    expect(configSource).toContain("SUPPORTED_E2E_BROWSERS = ['chromium', 'firefox', 'webkit']");
    expect(configSource).not.toMatch(/projects:\s*\[[\s\S]*Desktop Firefox[\s\S]*Desktop Safari/);
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
    expect(visualSmokeSource).toContain('/cudyr?date=');
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
