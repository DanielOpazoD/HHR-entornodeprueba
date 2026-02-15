import { describe, expect, it, vi } from 'vitest';
import { buildPatientRowInputCommands } from '@/features/census/controllers/patientRowInputHandlersController';

describe('patientRowInputHandlersController', () => {
  it('maps text/checkbox/device commands to updateField', () => {
    const updateField = vi.fn();
    const updateMultiple = vi.fn();
    const commands = buildPatientRowInputCommands({ updateField, updateMultiple });

    commands.setTextField('patientName', 'Paciente A');
    commands.setCheckboxField('isUPC', true);
    commands.setDevices(['VVP#1']);
    commands.setDeviceDetails({ VVP: { installationDate: '2026-02-14' } });
    commands.setDeviceHistory([]);

    expect(updateField).toHaveBeenCalledWith('patientName', 'Paciente A');
    expect(updateField).toHaveBeenCalledWith('isUPC', true);
    expect(updateField).toHaveBeenCalledWith('devices', ['VVP#1']);
    expect(updateField).toHaveBeenCalledWith('deviceDetails', {
      VVP: { installationDate: '2026-02-14' },
    });
    expect(updateField).toHaveBeenCalledWith('deviceInstanceHistory', []);
  });

  it('routes demographics save to updateMultiple', () => {
    const updateField = vi.fn();
    const updateMultiple = vi.fn();
    const commands = buildPatientRowInputCommands({ updateField, updateMultiple });

    commands.saveDemographics({ age: '40', pathology: 'Dx' });

    expect(updateMultiple).toHaveBeenCalledWith({ age: '40', pathology: 'Dx' });
    expect(updateField).not.toHaveBeenCalled();
  });
});
