import React, { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export default function PasswordInput({ id, className = '', disabled, ...props }: Props) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative block">
      <input
        {...props}
        id={inputId}
        disabled={disabled}
        type={visible ? 'text' : 'password'}
        className={`${className} pr-12`}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-pressed={visible}
        aria-controls={inputId}
        onClick={() => setVisible(value => !value)}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-stone-500 transition hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-teal-700 disabled:opacity-50"
      >
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </span>
  );
}
