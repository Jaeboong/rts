import { describe, expect, it } from 'vitest';

import { formatDecisionHistory, pushDecision, type DecisionRecord } from '../decision-history';

describe('pushDecision — ring buffer', () => {
  it('appends to an empty buffer', () => {
    const r: DecisionRecord = { tickAtRequest: 1, results: [] };
    expect(pushDecision([], r, 5)).toEqual([r]);
  });

  it('keeps only the last `cap` records', () => {
    let buf: readonly DecisionRecord[] = [];
    for (let i = 0; i < 12; i++) {
      buf = pushDecision(buf, { tickAtRequest: i, results: [] }, 5);
    }
    expect(buf).toHaveLength(5);
    expect(buf[0].tickAtRequest).toBe(7);
    expect(buf[4].tickAtRequest).toBe(11);
  });

  it('does not mutate the input array', () => {
    const original: readonly DecisionRecord[] = [{ tickAtRequest: 1, results: [] }];
    pushDecision(original, { tickAtRequest: 2, results: [] }, 5);
    expect(original).toHaveLength(1);
  });
});

describe('formatDecisionHistory', () => {
  it('returns "(no prior decisions)" on empty input', () => {
    expect(formatDecisionHistory([])).toBe('(no prior decisions)');
  });

  it('formats a single record with mixed ok / rejected commands', () => {
    const out = formatDecisionHistory([
      {
        tickAtRequest: 100,
        results: [
          { cmd: { type: 'gather', unitIds: [7, 8], nodeId: 200 }, ok: true },
          {
            cmd: { type: 'build', workerId: 9, building: 'barracks', cellX: 50, cellY: 50 },
            ok: false,
            reason: 'build site (50,50) blocked',
          },
        ],
      },
    ]);
    expect(out).toContain('@tick 100: 2 cmds — 1 ok, 1 rejected');
    expect(out).toContain('✓ gather([7,8] → 200)');
    expect(out).toContain('✗ build(9 barracks 50,50): build site (50,50) blocked');
  });

  it('describes all 8 command types', () => {
    const out = formatDecisionHistory([
      {
        tickAtRequest: 0,
        results: [
          { cmd: { type: 'move', unitIds: [1], target: { x: 10, y: 20 } }, ok: true },
          { cmd: { type: 'attackMove', unitIds: [2], target: { x: 30, y: 40 } }, ok: true },
          { cmd: { type: 'attack', unitIds: [3], targetId: 99 }, ok: true },
          { cmd: { type: 'gather', unitIds: [4], nodeId: 200 }, ok: true },
          { cmd: { type: 'build', workerId: 5, building: 'barracks', cellX: 1, cellY: 2 }, ok: true },
          { cmd: { type: 'produce', buildingId: 6, unit: 'marine' }, ok: true },
          { cmd: { type: 'setRally', buildingId: 7, pos: { x: 5, y: 5 } }, ok: true },
          { cmd: { type: 'cancel', entityId: 8 }, ok: true },
        ],
      },
    ]);
    expect(out).toContain('move(');
    expect(out).toContain('attackMove(');
    expect(out).toContain('attack(');
    expect(out).toContain('gather(');
    expect(out).toContain('build(');
    expect(out).toContain('produce(');
    expect(out).toContain('setRally(');
    expect(out).toContain('cancel(');
  });

  it('renders multiple cycles oldest → newest in order', () => {
    const out = formatDecisionHistory([
      { tickAtRequest: 1, results: [] },
      { tickAtRequest: 2, results: [] },
      { tickAtRequest: 3, results: [] },
    ]);
    const i1 = out.indexOf('@tick 1');
    const i2 = out.indexOf('@tick 2');
    const i3 = out.indexOf('@tick 3');
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
  });

  it('handles a record with no commands cleanly', () => {
    const out = formatDecisionHistory([{ tickAtRequest: 5, results: [] }]);
    expect(out).toContain('@tick 5: 0 cmds — 0 ok, 0 rejected');
  });
});
