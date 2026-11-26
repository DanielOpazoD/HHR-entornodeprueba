import React from 'react';
import {
  useCensusEmail,
  type UseCensusEmailParams,
} from '@/features/census/email/hooks/useCensusEmail';
import type { UseCensusEmailReturn } from '@/context/CensusContext';

export interface CensusEmailRuntimeBridgeProps {
  params: UseCensusEmailParams;
  onValueChange: (value: UseCensusEmailReturn) => void;
}

export const CensusEmailRuntimeBridge: React.FC<CensusEmailRuntimeBridgeProps> = ({
  params,
  onValueChange,
}) => {
  const value = useCensusEmail(params);

  React.useEffect(() => {
    onValueChange(value);
  }, [onValueChange, value]);

  return null;
};
