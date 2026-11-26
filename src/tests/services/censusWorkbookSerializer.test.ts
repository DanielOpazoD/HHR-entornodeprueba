// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { __private__ } from '@/services/exporters/excel/censusWorkbookSerializer';

describe('censusWorkbookSerializer', () => {
  it('produces the expected legacy workbook password hash for HHR', () => {
    expect(__private__.hashLegacyWorkbookPassword('HHR')).toBe('CD68');
  });

  it('injects workbookProtection after workbookPr when it is missing', () => {
    const xml =
      '<workbook><workbookPr date1904="0"/><bookViews><workbookView activeTab="3" firstSheet="3"/></bookViews></workbook>';

    const protectedXml = __private__.injectWorkbookProtectionXml(xml, 'CC44');

    expect(protectedXml).toContain(
      '<workbookPr date1904="0"/><workbookProtection lockStructure="1" workbookPassword="CC44"/>'
    );
  });
});
