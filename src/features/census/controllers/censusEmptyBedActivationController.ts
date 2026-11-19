import { ok, type ControllerResult } from '@/shared/contracts/controllerResult';

interface EmptyBedActivationRuntime {
  requestFrame: (callback: () => void) => void;
  querySelector: (selector: string) => Element | null;
}

export type EmptyBedActivationOutcome = 'focused' | 'input_not_found';
export type EmptyBedActivationResult = ControllerResult<{
  outcome: EmptyBedActivationOutcome;
  selector: string;
}>;

const MAX_ACTIVATION_ATTEMPTS = 6;

export const buildPatientNameSelector = (bedId: string): string =>
  `[data-bed-id="${bedId}"] input[name="patientName"]`;

export const buildDemographicsButtonSelector = (bedId: string): string =>
  `[data-bed-id="${bedId}"] [title="Datos del Paciente"]`;

const openDemographicsFromRow = (
  bedId: string,
  querySelector: EmptyBedActivationRuntime['querySelector']
): boolean => {
  const button = querySelector(buildDemographicsButtonSelector(bedId));
  if (button instanceof HTMLElement) {
    button.click();
    return true;
  }

  return false;
};

const focusPatientNameInput = (
  bedId: string,
  querySelector: EmptyBedActivationRuntime['querySelector']
): EmptyBedActivationResult => {
  const selector = buildPatientNameSelector(bedId);
  const nameInput = querySelector(selector);

  if (!(nameInput instanceof HTMLInputElement)) {
    return ok({
      outcome: 'input_not_found',
      selector,
    });
  }

  nameInput.value = '';
  nameInput.focus();

  return ok({
    outcome: 'focused',
    selector,
  });
};

export const executeActivateEmptyBedController = ({
  bedId,
  runtime,
}: {
  bedId: string;
  runtime: EmptyBedActivationRuntime;
}): EmptyBedActivationResult => {
  let outcome: EmptyBedActivationResult = ok({
    outcome: 'input_not_found',
    selector: buildPatientNameSelector(bedId),
  });

  const runFocusAttempt = (attempt: number) => {
    outcome = focusPatientNameInput(bedId, runtime.querySelector);

    const didOpenDemographics = openDemographicsFromRow(bedId, runtime.querySelector);
    const shouldRetry =
      outcome.ok &&
      outcome.value.outcome === 'input_not_found' &&
      attempt < MAX_ACTIVATION_ATTEMPTS;

    if (shouldRetry || (!didOpenDemographics && attempt < MAX_ACTIVATION_ATTEMPTS)) {
      runtime.requestFrame(() => {
        runFocusAttempt(attempt + 1);
      });
    }
  };

  try {
    runtime.requestFrame(() => {
      runFocusAttempt(1);
    });
  } catch {
    // Fallback for non-browser/test edge cases where RAF is unavailable.
    runFocusAttempt(MAX_ACTIVATION_ATTEMPTS);
  }

  return outcome;
};
