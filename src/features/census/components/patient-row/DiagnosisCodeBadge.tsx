import React from 'react';

interface DiagnosisCodeBadgeProps {
  code?: string;
  description?: string;
  className?: string;
}

export const DiagnosisCodeBadge: React.FC<DiagnosisCodeBadgeProps> = ({
  code,
  description,
  className = '',
}) => {
  const normalizedCode = code?.trim();
  if (!normalizedCode) return null;

  const tooltip = [normalizedCode, description?.trim()].filter(Boolean).join(' · ');

  return (
    <span
      className={`inline-flex max-w-14 items-center truncate rounded border border-sky-200 bg-sky-50 px-1 py-0.5 font-mono text-[9px] font-semibold text-sky-700 ${className}`}
      title={`CIE-10: ${tooltip}`}
      aria-label={`CIE-10 ${tooltip}`}
    >
      {normalizedCode}
    </span>
  );
};
