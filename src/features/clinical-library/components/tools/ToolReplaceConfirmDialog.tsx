import React from 'react';

interface ToolReplaceConfirmDialogProps {
  idPrefix: string;
  title: string;
  description: React.ReactNode;
  keepLabel?: string;
  confirmLabel: string;
  onKeep: () => void;
  onConfirm: () => void;
  containerClassName: string;
  titleClassName?: string;
  descriptionClassName?: string;
  actionsClassName: string;
  keepButtonClassName?: string;
  confirmButtonClassName?: string;
}

export const ToolReplaceConfirmDialog: React.FC<ToolReplaceConfirmDialogProps> = ({
  idPrefix,
  title,
  description,
  keepLabel = 'Conservar formulario',
  confirmLabel,
  onKeep,
  onConfirm,
  containerClassName,
  titleClassName,
  descriptionClassName,
  actionsClassName,
  keepButtonClassName,
  confirmButtonClassName,
}) => {
  const titleId = `${idPrefix}-replace-title`;
  const descriptionId = `${idPrefix}-replace-description`;

  return (
    <section
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={containerClassName}
    >
      <h4 id={titleId} className={titleClassName}>
        {title}
      </h4>
      <p id={descriptionId} className={descriptionClassName}>
        {description}
      </p>
      <div className={actionsClassName}>
        <button type="button" autoFocus onClick={onKeep} className={keepButtonClassName}>
          {keepLabel}
        </button>
        <button type="button" onClick={onConfirm} className={confirmButtonClassName}>
          {confirmLabel}
        </button>
      </div>
    </section>
  );
};
