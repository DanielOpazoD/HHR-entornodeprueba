import { describe, expect, it, vi } from 'vitest';
import { buildAppContentOverlayState } from '@/components/layout/app-content/appContentOverlaysController';

describe('appContentOverlaysController', () => {
  const ui = {
    patientSearchModal: {
      isOpen: true,
      close: vi.fn(),
    },
    isTestAgentRunning: true,
    setIsTestAgentRunning: vi.fn(),
  };

  const runtime = {
    censusEmail: {
      showEmailConfig: true,
      setShowEmailConfig: vi.fn(),
      recipients: ['a@hospital.cl'],
      setRecipients: vi.fn(),
      recipientLists: [{ id: 'default', name: 'Default', recipients: [] }],
      activeRecipientListId: 'default',
      setActiveRecipientListId: vi.fn(),
      createRecipientList: vi.fn(),
      renameActiveRecipientList: vi.fn(),
      deleteRecipientList: vi.fn(),
      recipientsSource: 'local',
      isRecipientsSyncing: false,
      recipientsSyncError: null,
      message: 'hola',
      onMessageChange: vi.fn(),
      onResetMessage: vi.fn(),
      isAdminUser: true,
      testModeEnabled: false,
      setTestModeEnabled: vi.fn(),
      testRecipient: 'test@hospital.cl',
      setTestRecipient: vi.fn(),
    },
    dateNav: {
      currentDateString: '2026-04-22',
    },
    nurseSignature: 'Enfermera Turno',
    record: { id: 'record-1' },
  };

  it('builds route-aware overlay props from runtime and ui state', () => {
    const onOpenCensusDate = vi.fn();
    const overlayState = buildAppContentOverlayState({
      ui: ui as never,
      runtime: runtime as never,
      onOpenCensusDate,
    });

    expect(overlayState.shouldRenderCensusEmailConfigModal).toBe(true);
    expect(overlayState.shouldRenderPatientSearchModal).toBe(true);
    expect(overlayState.shouldRenderTestAgent).toBe(true);
    expect(overlayState.censusEmailModalProps).toEqual(
      expect.objectContaining({
        recipients: ['a@hospital.cl'],
        activeRecipientListId: 'default',
        date: '2026-04-22',
        nursesSignature: 'Enfermera Turno',
        testRecipient: 'test@hospital.cl',
      })
    );
    expect(overlayState.testAgentProps).toEqual(
      expect.objectContaining({
        isRunning: true,
        currentRecord: { id: 'record-1' },
      })
    );
    expect(overlayState.patientSearchModalProps).toEqual({
      isOpen: true,
      onClose: ui.patientSearchModal.close,
      onNavigateToDate: onOpenCensusDate,
    });
  });

  it('wires modal and test agent callbacks back to the source state', () => {
    const overlayState = buildAppContentOverlayState({
      ui: ui as never,
      runtime: runtime as never,
    });

    overlayState.censusEmailModalProps.onClose();
    overlayState.testAgentProps.onComplete();

    expect(runtime.censusEmail.setShowEmailConfig).toHaveBeenCalledWith(false);
    expect(ui.setIsTestAgentRunning).toHaveBeenCalledWith(false);
  });
});
