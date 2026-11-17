// The role × write-kind matrix with no authority policy stored (half of the matrix that was
// missingRemoteDay; split so the two halves and the retries run on separate workers).
import { describeMissingRemoteDay, missingRemoteDayMatrix } from './missingRemoteDay.test-support';

describeMissingRemoteDay('demo-hhr-e8e-absent-policy', harness =>
  missingRemoteDayMatrix('absent', harness)
);
