import type { AICommand, CommandResult } from './types';

/**
 * One cycle's worth of LLM-emitted commands paired with the apply outcome.
 * The tracker (NanoclawPlayer) keeps the last N records in a ring buffer and
 * embeds a compact rendering in the next prompt — closes the feedback loop so
 * the model can stop repeating the same rejected command every cycle.
 */
export interface DecisionRecord {
  /** The world tick at which the prompt that produced these commands was built. */
  readonly tickAtRequest: number;
  /** Issue-order list of cmd + outcome. */
  readonly results: readonly CommandResult[];
}

/**
 * Append `record` and trim the buffer to `cap`. Returns a new array (no
 * in-place mutation) so callers can replace their stored field atomically.
 */
export function pushDecision(
  buffer: readonly DecisionRecord[],
  record: DecisionRecord,
  cap: number,
): DecisionRecord[] {
  return [...buffer, record].slice(-cap);
}

/**
 * Pretty-print the buffer for the prompt. Format per line:
 *
 *   @tick 240: 3 cmds — 2 ok, 1 rejected
 *     ✓ gather([41,46] → 15)
 *     ✓ produce(11 worker)
 *     ✗ build(7 barracks 50,50): site (50,50) blocked
 *
 * Stable ordering = oldest → newest so the LLM reads chronological context.
 */
export function formatDecisionHistory(
  decisions: readonly DecisionRecord[],
): string {
  if (decisions.length === 0) return '(no prior decisions)';
  const out: string[] = [];
  for (const d of decisions) {
    const okCount = d.results.filter((r) => r.ok).length;
    const failCount = d.results.length - okCount;
    out.push(
      `@tick ${d.tickAtRequest}: ${d.results.length} cmds — ${okCount} ok, ${failCount} rejected`,
    );
    for (const r of d.results) {
      const mark = r.ok ? '✓' : '✗';
      const desc = describeCommand(r.cmd);
      const tail = r.ok ? '' : `: ${r.reason ?? 'rejected'}`;
      out.push(`  ${mark} ${desc}${tail}`);
    }
  }
  return out.join('\n');
}

function describeCommand(cmd: AICommand): string {
  switch (cmd.type) {
    case 'move':
      return `move([${cmd.unitIds.join(',')}] → ${cmd.target.x},${cmd.target.y})`;
    case 'attackMove':
      return `attackMove([${cmd.unitIds.join(',')}] → ${cmd.target.x},${cmd.target.y})`;
    case 'attack':
      return `attack([${cmd.unitIds.join(',')}] → ${cmd.targetId})`;
    case 'gather':
      return `gather([${cmd.unitIds.join(',')}] → ${cmd.nodeId})`;
    case 'build':
      return `build(${cmd.workerId} ${cmd.building} ${cmd.cellX},${cmd.cellY})`;
    case 'produce':
      return `produce(${cmd.buildingId} ${cmd.unit})`;
    case 'setRally':
      return `setRally(${cmd.buildingId} → ${cmd.pos.x},${cmd.pos.y})`;
    case 'cancel':
      return `cancel(${cmd.entityId})`;
  }
}
