import React, { useState } from 'react';
import clsx from 'clsx';
import { useChangedOnRender } from '@/hooks/useChangedOnRender';

interface InlineEditableTitleProps {
  value: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onActivate?: () => void;
  onDeactivate?: () => void;
}

export const InlineEditableTitle: React.FC<InlineEditableTitleProps> = ({
  value,
  className,
  inputClassName,
  disabled = false,
  onChange,
  onActivate,
  onDeactivate,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(value);

  if (useChangedOnRender([value])) setDraftValue(value);

  const commit = () => {
    const normalized = draftValue.trim();
    onChange(normalized.length > 0 ? normalized : value);
    setIsEditing(false);
    onDeactivate?.();
  };

  if (disabled) {
    return <span className={className}>{value}</span>;
  }

  if (isEditing) {
    return (
      <input
        value={draftValue}
        aria-label={value || 'Editar título'}
        onChange={event => setDraftValue(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraftValue(value);
            setIsEditing(false);
            onDeactivate?.();
          }
        }}
        className={clsx('clinical-document-inline-title-input', inputClassName, className)}
        autoFocus
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={value || 'Sin título'}
      className={clsx('clinical-document-inline-title', className)}
      onClick={() => {
        setDraftValue(value);
        setIsEditing(true);
        onActivate?.();
      }}
      title="Haz clic para editar"
    >
      {value}
    </button>
  );
};
