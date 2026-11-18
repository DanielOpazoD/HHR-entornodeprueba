import {
  resolveRecipientMutationFailureMessage,
  type RecipientRuntimeState,
} from '@/features/census/email/controllers/censusEmailRecipientRuntimeController';
import {
  withRecipientListUseCases,
  type RecipientUseCaseResult,
} from '@/features/census/email/controllers/censusEmailRecipientUseCaseLoader';
import type { RecipientRuntimeMutationSpec } from '@/features/census/email/controllers/censusEmailRecipientMutationActionController';

interface RecipientMutationRunnerState<TData> {
  applyRuntimeState: (state: RecipientRuntimeState) => void;
  resolveRuntimeState: (data: NonNullable<TData>) => RecipientRuntimeState | null;
  setRecipientsSyncing: (isSyncing: boolean) => void;
  setRecipientsSyncError: (message: string | null) => void;
}

const isSuccessfulRecipientMutation = <TData>(
  result: RecipientUseCaseResult<TData>
): result is RecipientUseCaseResult<NonNullable<TData>> & {
  status: 'success';
  data: NonNullable<TData>;
} => result.status === 'success' && result.data != null;

export const executeRecipientRuntimeMutationSpec = async <TData>(
  spec: RecipientRuntimeMutationSpec<TData>,
  state: RecipientMutationRunnerState<TData>
): Promise<void> => {
  state.setRecipientsSyncing(true);
  state.setRecipientsSyncError(null);

  try {
    const result = await withRecipientListUseCases(useCases => spec.execute(useCases));
    if (isSuccessfulRecipientMutation(result)) {
      const nextState = state.resolveRuntimeState(result.data);
      if (nextState) {
        state.applyRuntimeState(nextState);
      }
      return;
    }

    state.setRecipientsSyncError(
      resolveRecipientMutationFailureMessage(result, spec.fallbackMessage)
    );
  } finally {
    state.setRecipientsSyncing(false);
  }
};
