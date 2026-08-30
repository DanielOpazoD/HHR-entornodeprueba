import { describe, expect, it, vi } from 'vitest';

import { BEDS } from '@/constants/beds';
import { buildPatientBedConfigSections } from '@/features/census/controllers/patientBedConfigSectionsController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('patientBedConfigSectionsController', () => {
  it('builds display, menu and extra location bindings from bed config state', () => {
    const onTextChange = vi.fn(() => vi.fn());

    const sections = buildPatientBedConfigSections({
      props: {
        bed: { ...BEDS[0], isExtra: true },
        data: DataFactory.createMockPatient('R1', { location: 'Sala Norte' }),
        currentDateString: '2026-03-05',
        isBlocked: false,
        hasCompanion: true,
        hasClinicalCrib: true,
        isCunaMode: false,
        onToggleCompanion: vi.fn(),
        onToggleClinicalCrib: vi.fn(),
        onTextChange,
        onUpdateClinicalCrib: vi.fn(),
        readOnly: false,
        align: 'bottom',
      },
      viewState: {
        daysHospitalized: 3,
        indicators: [
          {
            key: 'crib',
            className: 'x',
            title: 'Cuna',
            label: 'C',
          },
        ],
        clinicalCribModel: {
          className: 'crib',
          dotClassName: 'crib-dot',
        },
        showDaysCounter: true,
        showIndicators: true,
        showMenu: true,
        showClinicalCribToggle: true,
        showClinicalCribActions: true,
        showLegacyCompanionCleanup: true,
      },
      handlers: {
        handleToggleCompanion: vi.fn(),
        handleToggleClinicalCrib: vi.fn(),
        handleRemoveClinicalCrib: vi.fn(),
      },
    });

    expect(sections.display.bedName).toBe(BEDS[0].name);
    expect(sections.display.daysHospitalized).toBe(3);
    expect(sections.menu.align).toBe('bottom');
    expect(sections.menu.showLegacyCompanionCleanup).toBe(true);
    expect(sections.extraLocation.shouldRender).toBe(true);
    expect(sections.extraLocation.value).toBe('Sala Norte');
    expect(onTextChange).toHaveBeenCalledWith('location');
  });
});
