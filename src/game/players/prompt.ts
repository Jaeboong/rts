import type { GameView, ViewEntity } from './types';

// Downsampled minimap dimensions. Real grid is GRID_W×GRID_H (currently 128×128
// = ~16k chars per request) which is wasteful for an LLM scan. 32 cols × 16 rows
// keeps the prompt cheap while preserving rough spatial relations. Tweak here
// if the user wants higher fidelity.
const MINIMAP_COLS = 32;
const MINIMAP_ROWS = 16;

const RESOURCE_KINDS: ReadonlySet<string> = new Set(['mineralNode', 'gasGeyser']);

/**
 * Pure deterministic projection of a GameView into the prompt text format
 * documented in AI_INFRASTRUCTURE.md §4-4. Same input always produces identical
 * output; that property is what makes prompt.test.ts trustworthy as a snapshot
 * and what lets the user diff prompts across game ticks.
 */
export function buildPrompt(view: GameView): string {
  const lines: string[] = [];
  lines.push(`Tick: ${view.tick}`);
  lines.push(`Minerals: ${view.resources.minerals}`);
  lines.push(`Gas: ${view.resources.gas}`);
  lines.push(`Map: ${view.mapInfo.w}x${view.mapInfo.h} cells (cellPx=${view.mapInfo.cellPx})`);
  lines.push('');

  lines.push(`My units (${view.myEntities.length}):`);
  for (const e of sortById(view.myEntities)) {
    lines.push(`- ${formatEntity(e, view.mapInfo.cellPx)}`);
  }
  lines.push('');

  lines.push(`Enemy units (${view.visibleEnemies.length}):`);
  for (const e of sortById(view.visibleEnemies)) {
    lines.push(`- ${formatEntity(e, view.mapInfo.cellPx)}`);
  }
  lines.push('');

  lines.push(`Resources (${view.visibleResources.length}):`);
  for (const e of sortById(view.visibleResources)) {
    lines.push(`- ${formatEntity(e, view.mapInfo.cellPx)}`);
  }
  lines.push('');

  lines.push(`Minimap ${MINIMAP_COLS}x${MINIMAP_ROWS} (M=mine, E=enemy, R=resource, .=empty):`);
  for (const row of renderMinimap(view)) lines.push(row);
  lines.push('');

  lines.push('Reply with a JSON array of commands. Schema:');
  lines.push("[{type:'move', unitIds:[...], target:{x,y}}, ...]");
  lines.push('Valid types: move, attack, attackMove, gather, build, produce, setRally, cancel.');
  lines.push('Return ONLY the JSON array. No commentary.');

  return lines.join('\n');
}

function sortById(entities: readonly ViewEntity[]): ViewEntity[] {
  return [...entities].sort((a, b) => a.id - b.id);
}

function formatEntity(e: ViewEntity, cellPx: number): string {
  const cellX = e.cellX ?? Math.floor(e.pos.x / cellPx);
  const cellY = e.cellY ?? Math.floor(e.pos.y / cellPx);
  const flags: string[] = [];
  if (e.underConstruction) flags.push('underConstruction');
  const flagStr = flags.length > 0 ? ` [${flags.join(',')}]` : '';
  return `id=${e.id} ${e.kind} at (${cellX},${cellY}) hp=${e.hp}/${e.maxHp}${flagStr}`;
}

function renderMinimap(view: GameView): string[] {
  const cols = MINIMAP_COLS;
  const rows = MINIMAP_ROWS;
  const cellPx = view.mapInfo.cellPx;
  const mapW = view.mapInfo.w;
  const mapH = view.mapInfo.h;
  const grid: string[][] = [];
  for (let r = 0; r < rows; r++) {
    grid.push(new Array<string>(cols).fill('.'));
  }
  // Priority when two entity classes occupy the same downsampled cell:
  // enemy > my > resource. Enemies are most actionable for an attacker AI.
  const place = (e: ViewEntity, ch: string, priority: number): void => {
    const cellX = e.cellX ?? Math.floor(e.pos.x / cellPx);
    const cellY = e.cellY ?? Math.floor(e.pos.y / cellPx);
    if (cellX < 0 || cellY < 0 || cellX >= mapW || cellY >= mapH) return;
    const col = Math.min(cols - 1, Math.floor((cellX * cols) / mapW));
    const row = Math.min(rows - 1, Math.floor((cellY * rows) / mapH));
    const existing = grid[row][col];
    const existingPriority = priorityOf(existing);
    if (priority >= existingPriority) grid[row][col] = ch;
  };
  for (const e of sortById(view.visibleResources)) {
    if (RESOURCE_KINDS.has(e.kind)) place(e, 'R', 1);
  }
  for (const e of sortById(view.myEntities)) place(e, 'M', 2);
  for (const e of sortById(view.visibleEnemies)) place(e, 'E', 3);
  return grid.map((row) => row.join(''));
}

function priorityOf(ch: string): number {
  switch (ch) {
    case 'E':
      return 3;
    case 'M':
      return 2;
    case 'R':
      return 1;
    default:
      return 0;
  }
}
