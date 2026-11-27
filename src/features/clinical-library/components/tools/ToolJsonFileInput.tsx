import React from 'react';

interface ToolJsonFileInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  ariaLabel: string;
  onFileSelected: (file: File) => void;
}

export const ToolJsonFileInput: React.FC<ToolJsonFileInputProps> = ({
  inputRef,
  ariaLabel,
  onFileSelected,
}) => (
  <input
    ref={inputRef}
    type="file"
    accept=".json,application/json"
    aria-label={ariaLabel}
    className="hidden"
    onChange={event => {
      const file = event.target.files?.[0];
      if (file) onFileSelected(file);
      event.target.value = '';
    }}
  />
);
