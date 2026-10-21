import { defineConfig } from '@playwright/test';

// Used only by `playwright merge-reports` to rebuild the canonical preview
// report from the blobs written by every preview-smoke lane.
const previewArtifactsDir =
  process.env.PLAYWRIGHT_PREVIEW_ARTIFACTS_DIR || 'reports/e2e/preview-bootstrap';

export default defineConfig({
  testDir: './e2e',
  reporter: [
    ['list'],
    ['json', { outputFile: `${previewArtifactsDir}/report.json` }],
    ['junit', { outputFile: `${previewArtifactsDir}/report.junit.xml` }],
    ['html', { open: 'never', outputFolder: `${previewArtifactsDir}/html` }],
  ],
});
