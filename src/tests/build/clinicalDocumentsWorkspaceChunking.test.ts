// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chunkForModule } from '../../../scripts/config/chunkingPolicy';
import { ONLINE_ONLY_PRECACHE_PATTERNS } from '../../../scripts/config/onlineOnlyAssets.mjs';

describe('clinical documents workspace delivery', () => {
  it('isolates the on-demand workspace without capturing census-facing document contracts', () => {
    for (const file of [
      'components/ClinicalDocumentRichTextEditor.tsx',
      'services/clinicalDocumentPdfRenderService.ts',
      'styles/clinicalDocumentSheet.css',
      'styles/clinicalDocumentSheet.css?raw',
    ]) {
      expect(chunkForModule(`/repo/src/features/clinical-documents/${file}`)).toBe(
        'clinical-documents-workspace'
      );
    }
    expect(chunkForModule('/repo/src/domain/clinical-documents/schema.ts')).toBe('census-view');
    expect(chunkForModule('/repo/src/domain/clinical-documents/definitions.ts')).toBe(
      'census-view'
    );
    expect(chunkForModule('/repo/src/utils/htmlEscape.ts')).toBe('htmlEscape');
    for (const file of [
      'public.ts',
      'index.ts',
      'contracts/clinicalDocumentsPatientContract.ts',
      'components/ClinicalDocumentsModal.tsx',
    ]) {
      expect(chunkForModule(`/repo/src/features/clinical-documents/${file}`)).toBeUndefined();
    }
  });

  it('loads workspace JavaScript on demand but keeps its stylesheet precached', () => {
    const patterns = ONLINE_ONLY_PRECACHE_PATTERNS.map(pattern => new RegExp(pattern));
    expect(
      patterns.some(pattern => pattern.test('assets/clinical-documents-workspace-test.js'))
    ).toBe(true);
    expect(
      patterns.some(pattern => pattern.test('assets/clinical-documents-workspace-test.css'))
    ).toBe(false);
  });
});
