import { ok, type ControllerResult } from '@/features/census/controllers/controllerResult';

interface EmptyBedActivationRuntime {
    updatePatient: (bedId: string, field: 'patientName', value: string) => void;
    requestFrame: (callback: () => void) => void;
    querySelector: (selector: string) => Element | null;
}

export type EmptyBedActivationOutcome = 'focused' | 'input_not_found';
export type EmptyBedActivationResult = ControllerResult<{
    outcome: EmptyBedActivationOutcome;
    selector: string;
}>;

export const buildPatientNameSelector = (bedId: string): string =>
    `[data-bed-id="${bedId}"] input[name="patientName"]`;

const focusPatientNameInput = (
    bedId: string,
    querySelector: EmptyBedActivationRuntime['querySelector']
): EmptyBedActivationResult => {
    const selector = buildPatientNameSelector(bedId);
    const nameInput = querySelector(selector);

    if (!(nameInput instanceof HTMLInputElement)) {
        return ok({
            outcome: 'input_not_found',
            selector
        });
    }

    nameInput.value = '';
    nameInput.focus();

    return ok({
        outcome: 'focused',
        selector
    });
};

export const executeActivateEmptyBedController = ({
    bedId,
    runtime
}: {
    bedId: string;
    runtime: EmptyBedActivationRuntime;
}): EmptyBedActivationResult => {
    runtime.updatePatient(bedId, 'patientName', ' ');

    let outcome: EmptyBedActivationResult = ok({
        outcome: 'input_not_found',
        selector: buildPatientNameSelector(bedId)
    });

    const runFocus = () => {
        outcome = focusPatientNameInput(bedId, runtime.querySelector);
    };

    try {
        runtime.requestFrame(runFocus);
    } catch {
        // Fallback for non-browser/test edge cases where RAF is unavailable.
        runFocus();
    }

    return outcome;
};
