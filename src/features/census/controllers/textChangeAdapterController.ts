import type { ChangeEvent } from 'react';

type TextChangeDispatcher<TField extends string> = (
  field: TField
) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;

export const buildSyntheticTextChangeEvent = (value: string): ChangeEvent<HTMLInputElement> =>
  ({ target: { value } }) as ChangeEvent<HTMLInputElement>;

export const dispatchTextChangeValue = <TField extends string>(
  textChange: TextChangeDispatcher<TField>,
  field: TField,
  value: string
): void => {
  textChange(field)(buildSyntheticTextChangeEvent(value));
};
