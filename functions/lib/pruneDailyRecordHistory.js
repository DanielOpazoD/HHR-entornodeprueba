const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const {
  isValidCalendarDay,
  historyRetentionCutoff,
  selectDailyRecordHistory,
} = require('./dailyRecordHistoryRetention');

// Copies can weigh some 300 KB, and a batch of 400 stopped this run at the same day every time.
const DELETE_BATCH_SIZE = 20;

const runDailyRecordHistoryPrune = async ({
  firestore,
  apply = false,
  now = new Date(),
  elapsedMs = (() => {
    const started = performance.now();
    return () => performance.now() - started;
  })(),
  maxDurationMs = 480_000,
}) => {
  const counts = {
    daysReviewed: 0,
    snapshotsDeleted: 0,
    snapshotsKept: 0,
    snapshotsToDelete: 0,
    stoppedForTime: false,
  };
  const outOfTime = () => {
    if (elapsedMs() < maxDurationMs) return false;
    counts.stoppedForTime = true;
    return true;
  };
  const cutoffDay = historyRetentionCutoff(now);
  if (outOfTime()) return counts;
  const days = await firestore
    .collection('hospitals')
    .doc(HOSPITAL_ID)
    .collection('dailyRecords')
    .listDocuments();
  for (const day of days) {
    if (outOfTime()) break;
    if (!isValidCalendarDay(day.id)) continue;
    counts.daysReviewed += 1;
    if (day.id >= cutoffDay) continue;
    const history = day.collection('history');
    const copies = await history.select('snapshotTimestamp').get();
    const { deleteIds } = selectDailyRecordHistory({
      dayId: day.id,
      cutoffDay,
      snapshots: copies.docs.map(copy => ({
        id: copy.id,
        snapshotTimestamp: copy.get('snapshotTimestamp'),
      })),
    });
    counts.snapshotsToDelete += deleteIds.length;
    // Kept means still present among the copies read, including dry-run and uncommitted batches.
    counts.snapshotsKept += copies.docs.length;
    if (outOfTime()) break;
    if (!apply) continue;
    for (let offset = 0; offset < deleteIds.length; offset += DELETE_BATCH_SIZE) {
      if (outOfTime()) break;
      const ids = deleteIds.slice(offset, offset + DELETE_BATCH_SIZE);
      const batch = firestore.batch();
      for (const id of ids) batch.delete(history.doc(id));
      await batch.commit();
      counts.snapshotsDeleted += ids.length;
      counts.snapshotsKept -= ids.length;
    }
    if (counts.stoppedForTime) break;
  }
  return counts;
};

const createDailyRecordHistoryFunctions = ({ firestore }) => ({
  pruneDailyRecordHistory: functions
    .region('southamerica-east1')
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .pubsub.schedule('30 4 * * *')
    .timeZone('Pacific/Easter')
    .onRun(async () => {
      try {
        const counts = await runDailyRecordHistoryPrune({ firestore, apply: true });
        functions.logger.info('daily_record_history_prune', counts);
      } catch (error) {
        // Only the numeric status: no raw SDK errors, paths or snapshot contents in telemetry.
        functions.logger.error('daily_record_history_prune_failed', {
          failed: true,
          code: Number.isInteger(error?.code) ? error.code : null,
        });
        throw new Error('Daily record history pruning failed');
      }
    }),
});

module.exports = { createDailyRecordHistoryFunctions, runDailyRecordHistoryPrune };
