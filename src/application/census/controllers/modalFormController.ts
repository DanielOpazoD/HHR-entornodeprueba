type ModalFieldErrorValue = string | undefined;

interface SubmitModalFormParams<
  TState,
  TErrors extends { [K in keyof TErrors]?: ModalFieldErrorValue },
  TPayload,
> {
  state: TState;
  validate: (state: TState) => TErrors;
  buildPayload: (state: TState) => TPayload;
  onValidationErrors: (errors: TErrors) => void;
  onConfirm: (payload: TPayload) => void;
}

export const hasModalFieldErrors = <
  TErrors extends { [K in keyof TErrors]?: ModalFieldErrorValue },
>(
  fieldErrors: TErrors
): boolean =>
  Object.values(fieldErrors).some(error => typeof error === 'string' && error.length > 0);

export const clearModalFieldErrors = <
  TErrors extends { [K in keyof TErrors]?: ModalFieldErrorValue },
>(
  currentErrors: TErrors,
  fields: readonly (keyof TErrors)[]
): TErrors => {
  let nextErrors: TErrors | null = null;

  fields.forEach(field => {
    if (currentErrors[field] === undefined) {
      return;
    }

    if (!nextErrors) {
      nextErrors = { ...currentErrors };
    }
    nextErrors[field] = undefined as TErrors[keyof TErrors];
  });

  return nextErrors ?? currentErrors;
};

export const submitModalForm = <
  TState,
  TErrors extends { [K in keyof TErrors]?: ModalFieldErrorValue },
  TPayload,
>({
  state,
  validate,
  buildPayload,
  onValidationErrors,
  onConfirm,
}: SubmitModalFormParams<TState, TErrors, TPayload>): boolean => {
  const errors = validate(state);

  if (hasModalFieldErrors(errors)) {
    onValidationErrors(errors);
    return false;
  }

  onConfirm(buildPayload(state));
  return true;
};
