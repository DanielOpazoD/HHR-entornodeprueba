// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  buildCensusActionCommandsControllerValue,
  buildCensusActionNotifyErrorAdapter,
} from '@/features/census/controllers/censusActionCommandsController';

describe('censusActionCommandsController', () => {
  it('adapts structured notifications to the runtime notifyError signature', () => {
    const notifyError = vi.fn();
    const adapter = buildCensusActionNotifyErrorAdapter(notifyError);

    adapter({
      title: 'Error',
      message: 'Fallo',
    });

    expect(notifyError).toHaveBeenCalledWith('Error', 'Fallo');
  });

  it('builds a stable command bundle from the resolved handlers', () => {
    const executeMoveOrCopy = vi.fn();
    const executeDischarge = vi.fn();
    const executeTransfer = vi.fn();
    const handleRowAction = vi.fn();

    const value = buildCensusActionCommandsControllerValue({
      executeMoveOrCopy,
      executeDischarge,
      executeTransfer,
      handleRowAction,
    });

    expect(value.executeMoveOrCopy).toBe(executeMoveOrCopy);
    expect(value.executeDischarge).toBe(executeDischarge);
    expect(value.executeTransfer).toBe(executeTransfer);
    expect(value.handleRowAction).toBe(handleRowAction);
  });
});
