import { canBuildingProduceUnits } from '../game/balance';
import type { World } from '../game/world';
import type { BuildingKind, Entity, EntityId, UnitKind } from '../types';

export interface QueueItemInfo {
  produces: UnitKind;
  isHead: boolean;
  // 0..1 progress for the head item; undefined for non-head queued items.
  progress: number | undefined;
}

export interface ProductionQueuePanel {
  producerId: EntityId;
  items: readonly QueueItemInfo[];
  rect: { x: number; y: number; w: number; h: number };
}

// Layout — anchored to the right side of the bottom HUD so it sits in the
// "center" between the left selection panel + button grid (≈x=240..640) and
// the right edge. Width and slot size chosen to fit up to MAX_VISIBLE items.
export const PRODUCTION_PANEL_W = 320;
export const PRODUCTION_PANEL_H = 110;
export const PRODUCTION_PANEL_RIGHT_PAD = 12;
export const PRODUCTION_PANEL_TOP_PAD = 10;
const SLOT_W = 32;
const SLOT_H = 32;
const SLOT_GAP = 6;
const PROGRESS_BAR_H = 6;
const MAX_VISIBLE = 5;

/**
 * Returns the queue render plan, or null when there's no producer to show.
 *
 * Selection rule: the first selected player-team building that *can* produce
 * units (regardless of whether its queue is empty). When none qualifies we
 * return null so the caller leaves the panel area blank.
 *
 * `panelH` is the bottom-HUD height — the panel is anchored to the bottom.
 */
export function computeProductionQueuePanel(
  world: World,
  viewW: number,
  viewH: number,
  panelH: number,
): ProductionQueuePanel | null {
  const producer = firstSelectedProducer(world);
  if (!producer) return null;
  const queue = producer.productionQueue ?? [];
  const visible = queue.slice(0, MAX_VISIBLE);
  const items: QueueItemInfo[] = visible.map((item, idx) => {
    const isHead = idx === 0;
    return {
      produces: item.produces,
      isHead,
      progress: isHead
        ? clamp01(1 - item.remainingSeconds / item.totalSeconds)
        : undefined,
    };
  });
  const rect = {
    x: viewW - PRODUCTION_PANEL_W - PRODUCTION_PANEL_RIGHT_PAD,
    y: viewH - panelH + PRODUCTION_PANEL_TOP_PAD,
    w: PRODUCTION_PANEL_W,
    h: PRODUCTION_PANEL_H,
  };
  return { producerId: producer.id, items, rect };
}

function firstSelectedProducer(world: World): Entity | null {
  for (const id of world.selection) {
    const e = world.entities.get(id);
    if (!e) continue;
    if (e.team !== 'player') continue;
    const bk = asBuildingKind(e.kind);
    if (!bk) continue;
    if (!canBuildingProduceUnits(bk)) continue;
    return e;
  }
  return null;
}

const BUILDING_KINDS: ReadonlySet<BuildingKind> = new Set<BuildingKind>([
  'commandCenter',
  'barracks',
  'turret',
  'refinery',
  'factory',
  'supplyDepot',
]);

function asBuildingKind(kind: string): BuildingKind | null {
  return BUILDING_KINDS.has(kind as BuildingKind) ? (kind as BuildingKind) : null;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function drawProductionQueuePanel(
  ctx: CanvasRenderingContext2D,
  panel: ProductionQueuePanel,
): void {
  // Background tint to anchor the panel visually inside the bottom HUD.
  ctx.fillStyle = 'rgba(20,20,28,0.45)';
  ctx.fillRect(panel.rect.x, panel.rect.y, panel.rect.w, panel.rect.h);
  ctx.strokeStyle = '#3a4a66';
  ctx.lineWidth = 1;
  ctx.strokeRect(
    panel.rect.x + 0.5,
    panel.rect.y + 0.5,
    panel.rect.w - 1,
    panel.rect.h - 1,
  );

  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#bbb';
  ctx.textAlign = 'start';
  ctx.textBaseline = 'top';
  ctx.fillText('Production Queue', panel.rect.x + 8, panel.rect.y + 4);

  if (panel.items.length === 0) {
    ctx.fillStyle = '#666';
    ctx.fillText('— empty —', panel.rect.x + 8, panel.rect.y + 24);
    return;
  }

  let x = panel.rect.x + 8;
  const y = panel.rect.y + 22;
  for (let i = 0; i < panel.items.length; i++) {
    const item = panel.items[i];
    // Slot background.
    ctx.fillStyle = item.isHead ? 'rgba(74,140,255,0.3)' : 'rgba(80,80,80,0.25)';
    ctx.fillRect(x, y, SLOT_W, SLOT_H);
    ctx.strokeStyle = item.isHead ? '#4a8cff' : '#555';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, SLOT_W - 1, SLOT_H - 1);
    // Unit short label (no atlas dependency yet).
    ctx.fillStyle = '#e0e0e0';
    ctx.font = '12px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(shortLabel(item.produces), x + SLOT_W / 2, y + SLOT_H / 2);
    x += SLOT_W + SLOT_GAP;
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'top';

  // Head progress bar spans the full panel content row below the slots.
  const head = panel.items[0];
  if (head && head.progress !== undefined) {
    const barX = panel.rect.x + 8;
    const barY = y + SLOT_H + 8;
    const barW = panel.rect.w - 16;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(barX, barY, barW, PROGRESS_BAR_H);
    ctx.fillStyle = '#f0c040';
    ctx.fillRect(barX, barY, barW * head.progress, PROGRESS_BAR_H);
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = '#bbb';
    ctx.fillText(
      `${head.produces} ${(head.progress * 100).toFixed(0)}%`,
      barX,
      barY + PROGRESS_BAR_H + 2,
    );
  }
}

function shortLabel(unit: UnitKind): string {
  switch (unit) {
    case 'worker':
      return 'Wkr';
    case 'marine':
      return 'Mar';
    case 'tank':
      return 'Tnk';
    case 'tank-light':
      return 'TkL';
    case 'medic':
      return 'Med';
    case 'enemyDummy':
      return 'Dmy';
  }
}
