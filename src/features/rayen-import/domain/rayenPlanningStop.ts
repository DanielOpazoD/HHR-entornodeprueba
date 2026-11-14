/**
 * A reconciliation that stops on purpose. Its message is written for the person who syncs; any
 * other error raised while planning is a technical failure whose text only the administrator sees.
 */
export class RayenPlanningStop extends Error {}
