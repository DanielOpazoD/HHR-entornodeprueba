export interface ControllerError<TCode extends string = string> {
    code: TCode;
    message: string;
}

export type ControllerSuccess<TValue> = { ok: true; value: TValue };
export type ControllerFailure<TError extends ControllerError<string>> = {
    ok: false;
    error: TError;
};

export type ControllerResult<
    TValue,
    TCode extends string = string,
    TError extends ControllerError<TCode> = ControllerError<TCode>
> = ControllerSuccess<TValue> | ControllerFailure<TError>;

export const ok = <TValue>(value: TValue): ControllerSuccess<TValue> => ({
    ok: true,
    value
});

export const fail = <
    TCode extends string,
    TError extends ControllerError<TCode>
>(error: TError): ControllerFailure<TError> => ({
    ok: false,
    error
});

export const failWithCode = <TCode extends string>(
    code: TCode,
    message: string
): ControllerFailure<ControllerError<TCode>> => fail({ code, message });
