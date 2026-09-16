import React from 'react';

interface UpcRoundNurseControlProps {
  assignedNurses: readonly string[];
  nurseName: string;
  disabled: boolean;
  onChange: (name: string) => void;
}

/** Selector del responsable común para todas las evaluaciones de la ronda UPC. */
export const UpcRoundNurseControl: React.FC<UpcRoundNurseControlProps> = ({
  assignedNurses,
  nurseName,
  disabled,
  onChange,
}) => (
  <label className="inline-flex items-center gap-2">
    <span className="font-semibold">Enfermero/a</span>
    {assignedNurses.length ? (
      <select
        aria-label="Enfermero responsable de la ronda UPC"
        value={nurseName}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        className="rounded border border-slate-300 px-2 py-1"
      >
        <option value="">Seleccionar responsable</option>
        {assignedNurses.map(name => (
          <option key={name}>{name}</option>
        ))}
      </select>
    ) : (
      <input
        aria-label="Nombre del enfermero responsable de la ronda UPC"
        value={nurseName}
        maxLength={120}
        autoComplete="off"
        placeholder="Escribe tu nombre"
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        className="w-40 rounded border border-slate-300 px-2 py-1"
      />
    )}
  </label>
);
