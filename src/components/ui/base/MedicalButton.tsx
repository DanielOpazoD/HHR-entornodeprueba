import React from 'react';
import { Button } from './Button';
import type { ButtonVariant } from './buttonStyles';

export type MedicalButtonVariant = ButtonVariant;

interface MedicalButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: MedicalButtonVariant;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
}

/** Retains the existing API while sharing geometry, hierarchy and keyboard focus. */
export const MedicalButton: React.FC<MedicalButtonProps> = props => <Button {...props} />;
