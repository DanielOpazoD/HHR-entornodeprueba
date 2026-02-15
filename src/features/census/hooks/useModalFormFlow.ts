import { useCallback, useEffect, useState } from 'react';

import {
  clearModalFieldErrors,
  submitModalForm,
} from '@/features/census/controllers/modalFormController';
import { useLatestRef } from '@/hooks/useLatestRef';

type ModalFieldErrorValue = string | undefined;

interface UseModalFormFlowParams<
  TFormState,
  TErrors extends { [K in keyof TErrors]?: ModalFieldErrorValue },
  TPayload,
> {
  isOpen: boolean;
  resolveInitialState: () => TFormState;
  createInitialErrors: () => TErrors;
  validate: (state: TFormState) => TErrors;
  buildPayload: (state: TFormState) => TPayload;
  onConfirm: (payload: TPayload) => void;
}

export interface UseModalFormFlowResult<
  TFormState,
  TErrors extends { [K in keyof TErrors]?: ModalFieldErrorValue },
> {
  formState: TFormState;
  errors: TErrors;
  patchFormState: (
    patch: Partial<TFormState>,
    clearErrorFields?: readonly (keyof TErrors)[]
  ) => void;
  setFormField: <K extends keyof TFormState>(
    field: K,
    value: TFormState[K],
    clearErrorFields?: readonly (keyof TErrors)[]
  ) => void;
  clearErrors: (fields: readonly (keyof TErrors)[]) => void;
  submit: () => boolean;
}

export const useModalFormFlow = <
  TFormState,
  TErrors extends { [K in keyof TErrors]?: ModalFieldErrorValue },
  TPayload,
>({
  isOpen,
  resolveInitialState,
  createInitialErrors,
  validate,
  buildPayload,
  onConfirm,
}: UseModalFormFlowParams<TFormState, TErrors, TPayload>): UseModalFormFlowResult<
  TFormState,
  TErrors
> => {
  const resolveInitialStateRef = useLatestRef(resolveInitialState);
  const createInitialErrorsRef = useLatestRef(createInitialErrors);
  const validateRef = useLatestRef(validate);
  const buildPayloadRef = useLatestRef(buildPayload);
  const onConfirmRef = useLatestRef(onConfirm);

  const [formState, setFormState] = useState<TFormState>(() => resolveInitialState());
  const [errors, setErrors] = useState<TErrors>(() => createInitialErrors());

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setFormState(resolveInitialStateRef.current());
    setErrors(createInitialErrorsRef.current());
  }, [createInitialErrorsRef, isOpen, resolveInitialStateRef]);

  const clearErrors = useCallback((fields: readonly (keyof TErrors)[]) => {
    setErrors(prev => clearModalFieldErrors(prev, fields));
  }, []);

  const patchFormState = useCallback(
    (patch: Partial<TFormState>, clearErrorFields: readonly (keyof TErrors)[] = []) => {
      setFormState(prev => ({ ...prev, ...patch }));
      if (clearErrorFields.length > 0) {
        clearErrors(clearErrorFields);
      }
    },
    [clearErrors]
  );

  const setFormField = useCallback(
    <K extends keyof TFormState>(
      field: K,
      value: TFormState[K],
      clearErrorFields: readonly (keyof TErrors)[] = []
    ) => {
      setFormState(prev => ({ ...prev, [field]: value }));
      if (clearErrorFields.length > 0) {
        clearErrors(clearErrorFields);
      }
    },
    [clearErrors]
  );

  const submit = useCallback(
    (): boolean =>
      submitModalForm({
        state: formState,
        validate: validateRef.current,
        buildPayload: buildPayloadRef.current,
        onValidationErrors: setErrors,
        onConfirm: onConfirmRef.current,
      }),
    [buildPayloadRef, formState, onConfirmRef, validateRef]
  );

  return {
    formState,
    errors,
    patchFormState,
    setFormField,
    clearErrors,
    submit,
  };
};
