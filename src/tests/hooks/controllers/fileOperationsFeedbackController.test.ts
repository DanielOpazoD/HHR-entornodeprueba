// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildExportCsvNotification,
  buildExportJsonNotification,
  buildImportFileErrorNotification,
} from '@/hooks/controllers/fileOperationsFeedbackController';

describe('fileOperationsFeedbackController', () => {
  it('builds export notifications', () => {
    expect(buildExportJsonNotification('success').title).toContain('exportados');
    expect(buildExportCsvNotification('error').channel).toBe('error');
  });

  it('builds import error notifications by reason', () => {
    expect(buildImportFileErrorNotification('invalid_format').message).toBe('Formato Inválido');
    expect(buildImportFileErrorNotification('processing_failed').title).toContain('procesar');
  });
});
