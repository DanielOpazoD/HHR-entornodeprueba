// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildCensusEmailRecipientsBulkEditorState,
  buildCensusEmailRecipientsEditorResetState,
} from '@/features/census/controllers/censusEmailRecipientsEditorStateController';

describe('censusEmailRecipientsEditorStateController', () => {
  it('builds the transient reset state for a modal reopen', () => {
    expect(buildCensusEmailRecipientsEditorResetState(['a@mail.com', 'b@mail.com'])).toEqual({
      error: null,
      newRecipient: '',
      showBulkEditor: false,
      bulkRecipients: 'a@mail.com\nb@mail.com',
      editingIndex: null,
      editingValue: '',
      showAllRecipients: false,
    });
  });

  it('builds a reusable bulk-editor state for open and cancel transitions', () => {
    expect(buildCensusEmailRecipientsBulkEditorState(['a@mail.com', 'b@mail.com'], true)).toEqual({
      showBulkEditor: true,
      bulkRecipients: 'a@mail.com\nb@mail.com',
      error: null,
    });
    expect(buildCensusEmailRecipientsBulkEditorState(['a@mail.com', 'b@mail.com'], false)).toEqual({
      showBulkEditor: false,
      bulkRecipients: 'a@mail.com\nb@mail.com',
      error: null,
    });
  });
});
