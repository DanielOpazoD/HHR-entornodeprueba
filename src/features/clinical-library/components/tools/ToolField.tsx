import React from 'react';
import clsx from 'clsx';

export const TOOL_INPUT_CLASS =
  'h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[13px] text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-medical-500 focus:outline-none focus:ring-2 focus:ring-medical-200 disabled:bg-slate-50 disabled:text-slate-400';

const LABEL_CLASS = 'mb-1 block text-[11px] font-semibold text-slate-600';

interface NumberFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit?: string;
  placeholder?: string;
  hint?: string;
  invalid?: boolean;
}

export const NumberField: React.FC<NumberFieldProps> = ({
  id,
  label,
  value,
  onChange,
  unit,
  placeholder,
  hint,
  invalid = false,
}) => (
  <div>
    <label htmlFor={id} className={LABEL_CLASS}>
      {label}
    </label>
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={clsx(
          TOOL_INPUT_CLASS,
          'tabular-nums',
          unit && 'pr-14',
          invalid && 'border-amber-400 focus:border-amber-500 focus:ring-amber-200'
        )}
      />
      {unit && (
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] font-semibold text-slate-400">
          {unit}
        </span>
      )}
    </div>
    {hint && (
      <p id={`${id}-hint`} className="mt-1 text-[10px] text-slate-500">
        {hint}
      </p>
    )}
  </div>
);

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectGroup<T extends string> {
  label: string;
  options: ReadonlyArray<SelectOption<T>>;
}

interface SelectFieldProps<T extends string> {
  id: string;
  label: string;
  value: T;
  onChange: (value: T) => void;
  options?: ReadonlyArray<SelectOption<T>>;
  groups?: ReadonlyArray<SelectGroup<T>>;
}

const renderOption = <T extends string>(option: SelectOption<T>): React.ReactElement => (
  <option key={option.value} value={option.value}>
    {option.label}
  </option>
);

export function SelectField<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
  groups,
}: SelectFieldProps<T>): React.ReactElement {
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={event => onChange(event.target.value as T)}
        className={clsx(TOOL_INPUT_CLASS, 'pr-8')}
      >
        {options?.map(renderOption)}
        {groups?.map(group => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map(renderOption)}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean; title?: string }>;
}

export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
}: SegmentedControlProps<T>): React.ReactElement {
  return (
    <div>
      <span className={LABEL_CLASS}>{label}</span>
      <div
        role="group"
        aria-label={label}
        className="flex h-9 rounded-md border border-slate-200 bg-slate-100 p-0.5"
      >
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={clsx(
              'min-w-0 flex-1 truncate rounded px-2 text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600 disabled:cursor-not-allowed disabled:opacity-40',
              value === option.value
                ? 'bg-white text-medical-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ResultTileProps {
  label: string;
  value: string | null;
  unit?: string;
  hint?: string;
  emphasis?: boolean;
  testId?: string;
}

export const ResultTile: React.FC<ResultTileProps> = ({
  label,
  value,
  unit,
  hint,
  emphasis = false,
  testId,
}) => (
  <div
    data-testid={testId}
    className={clsx(
      'rounded-lg border px-3 py-2',
      emphasis ? 'border-medical-200 bg-medical-50' : 'border-slate-200 bg-white'
    )}
  >
    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p
      className={clsx(
        'mt-0.5 tabular-nums',
        emphasis ? 'text-2xl font-bold text-medical-800' : 'text-base font-semibold text-slate-800'
      )}
    >
      {value ?? <span className="text-slate-300">—</span>}
      {value && unit && (
        <span className="ml-1 text-[11px] font-semibold text-slate-500">{unit}</span>
      )}
    </p>
    {hint && <p className="mt-0.5 text-[10px] text-slate-500">{hint}</p>}
  </div>
);

export const ToolSection: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section aria-label={title} className="mt-3 first:mt-0">
    <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</h4>
    {children}
  </section>
);
