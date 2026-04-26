import type { BuildingKind, EntityId, UnitKind, Vec2 } from '../../types';
import { BUILDING_DEFS, UNIT_DEFS } from '../balance';

import type { AICommand, GameView, ViewEntity } from './types';

const COMMAND_TYPES = new Set([
  'move',
  'attack',
  'attackMove',
  'gather',
  'build',
  'produce',
  'setRally',
  'cancel',
]);

const UNIT_KIND_SET = new Set<string>(Object.keys(UNIT_DEFS));
const BUILDING_KIND_SET = new Set<string>(Object.keys(BUILDING_DEFS));
const GATHERABLE_KINDS = new Set<string>(['mineralNode', 'supplyDepot']);

/**
 * Convert a raw LLM response (possibly wrapped in markdown fences, possibly
 * containing trailing prose, possibly bogus JSON) into a list of validated
 * AICommand[]. Never throws; warn-logs and skips per-command on any defect.
 *
 * Validation guards (per command):
 *   - type is in COMMAND_TYPES whitelist
 *   - all referenced IDs resolve to live entities in `view` with the right role
 *   - building/unit kind enums are recognized
 *   - target Vec2 fields are finite numbers
 *
 * The applier (`command-applier.ts`) does a second, world-grounded pass; this
 * parser's job is to filter the obvious junk before it ever touches the world.
 */
export function parseCommands(raw: string, view: GameView): AICommand[] {
  const body = stripFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    console.warn('[nanoclaw-parser] JSON.parse failed', err);
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.warn('[nanoclaw-parser] response is not an array', typeof parsed);
    return [];
  }

  const lookup = buildLookup(view);
  const out: AICommand[] = [];
  for (const item of parsed) {
    const cmd = validate(item, lookup);
    if (cmd) out.push(cmd);
  }
  return out;
}

/**
 * Strip ` ```json ... ``` ` or ``` ... ``` markdown fences if present. Returns
 * the trimmed inner body, or the original string if no fence matched.
 */
function stripFence(raw: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/m.exec(raw);
  if (fence) return fence[1].trim();
  return raw.trim();
}

interface ViewLookup {
  readonly myUnits: ReadonlyMap<EntityId, ViewEntity>;
  readonly myBuildings: ReadonlyMap<EntityId, ViewEntity>;
  readonly myEntities: ReadonlyMap<EntityId, ViewEntity>;
  readonly enemies: ReadonlyMap<EntityId, ViewEntity>;
  readonly resources: ReadonlyMap<EntityId, ViewEntity>;
}

function buildLookup(view: GameView): ViewLookup {
  const myUnits = new Map<EntityId, ViewEntity>();
  const myBuildings = new Map<EntityId, ViewEntity>();
  const myEntities = new Map<EntityId, ViewEntity>();
  for (const e of view.myEntities) {
    myEntities.set(e.id, e);
    if (UNIT_KIND_SET.has(e.kind)) myUnits.set(e.id, e);
    else if (BUILDING_KIND_SET.has(e.kind)) myBuildings.set(e.id, e);
  }
  const enemies = new Map<EntityId, ViewEntity>();
  for (const e of view.visibleEnemies) enemies.set(e.id, e);
  const resources = new Map<EntityId, ViewEntity>();
  for (const e of view.visibleResources) resources.set(e.id, e);
  // supplyDepots are owned buildings but valid gather targets too (gather system
  // resolves the actual mineral node behind it). Mirror them into resources.
  for (const e of view.myEntities) {
    if (e.kind === 'supplyDepot') resources.set(e.id, e);
  }
  return { myUnits, myBuildings, myEntities, enemies, resources };
}

function validate(raw: unknown, lookup: ViewLookup): AICommand | null {
  if (!isRecord(raw)) return warn('command not an object');
  const type = raw.type;
  if (typeof type !== 'string' || !COMMAND_TYPES.has(type)) {
    return warn(`unknown command type ${String(type)}`);
  }

  switch (type) {
    case 'move':
      return validateMoveLike(raw, lookup, 'move');
    case 'attackMove':
      return validateMoveLike(raw, lookup, 'attackMove');
    case 'attack':
      return validateAttack(raw, lookup);
    case 'gather':
      return validateGather(raw, lookup);
    case 'build':
      return validateBuild(raw, lookup);
    case 'produce':
      return validateProduce(raw, lookup);
    case 'setRally':
      return validateSetRally(raw, lookup);
    case 'cancel':
      return validateCancel(raw, lookup);
    default:
      return warn(`unhandled command type ${type}`);
  }
}

function validateMoveLike(
  raw: Record<string, unknown>,
  lookup: ViewLookup,
  type: 'move' | 'attackMove',
): AICommand | null {
  const unitIds = filterUnitIds(raw.unitIds, lookup);
  if (unitIds.length === 0) return warn(`${type}: no valid unitIds`);
  const target = parseVec2(raw.target);
  if (!target) return warn(`${type}: invalid target`);
  return { type, unitIds, target };
}

function validateAttack(
  raw: Record<string, unknown>,
  lookup: ViewLookup,
): AICommand | null {
  const unitIds = filterUnitIds(raw.unitIds, lookup);
  if (unitIds.length === 0) return warn('attack: no valid unitIds');
  const targetId = parseId(raw.targetId);
  if (targetId === null) return warn('attack: invalid targetId');
  if (!lookup.enemies.has(targetId)) {
    return warn(`attack: targetId ${targetId} not in visibleEnemies`);
  }
  return { type: 'attack', unitIds, targetId };
}

function validateGather(
  raw: Record<string, unknown>,
  lookup: ViewLookup,
): AICommand | null {
  const workers = filterUnitIds(raw.unitIds, lookup, 'worker');
  if (workers.length === 0) return warn('gather: no valid worker unitIds');
  const nodeId = parseId(raw.nodeId);
  if (nodeId === null) return warn('gather: invalid nodeId');
  const node = lookup.resources.get(nodeId);
  if (!node || !GATHERABLE_KINDS.has(node.kind)) {
    return warn(`gather: nodeId ${nodeId} not gatherable`);
  }
  return { type: 'gather', unitIds: workers, nodeId };
}

function validateBuild(
  raw: Record<string, unknown>,
  lookup: ViewLookup,
): AICommand | null {
  const workerId = parseId(raw.workerId);
  if (workerId === null) return warn('build: invalid workerId');
  const worker = lookup.myUnits.get(workerId);
  if (!worker || worker.kind !== 'worker') {
    return warn(`build: workerId ${workerId} not an owned worker`);
  }
  const building = raw.building;
  if (typeof building !== 'string' || !BUILDING_KIND_SET.has(building)) {
    return warn(`build: invalid building ${String(building)}`);
  }
  const cellX = parseInteger(raw.cellX);
  const cellY = parseInteger(raw.cellY);
  if (cellX === null || cellY === null) return warn('build: invalid cellX/cellY');
  return {
    type: 'build',
    workerId,
    building: building as BuildingKind,
    cellX,
    cellY,
  };
}

function validateProduce(
  raw: Record<string, unknown>,
  lookup: ViewLookup,
): AICommand | null {
  const buildingId = parseId(raw.buildingId);
  if (buildingId === null) return warn('produce: invalid buildingId');
  if (!lookup.myBuildings.has(buildingId)) {
    return warn(`produce: buildingId ${buildingId} not an owned building`);
  }
  const unit = raw.unit;
  if (typeof unit !== 'string' || !UNIT_KIND_SET.has(unit)) {
    return warn(`produce: invalid unit ${String(unit)}`);
  }
  return { type: 'produce', buildingId, unit: unit as UnitKind };
}

function validateSetRally(
  raw: Record<string, unknown>,
  lookup: ViewLookup,
): AICommand | null {
  const buildingId = parseId(raw.buildingId);
  if (buildingId === null) return warn('setRally: invalid buildingId');
  if (!lookup.myBuildings.has(buildingId)) {
    return warn(`setRally: buildingId ${buildingId} not an owned building`);
  }
  const pos = parseVec2(raw.pos);
  if (!pos) return warn('setRally: invalid pos');
  return { type: 'setRally', buildingId, pos };
}

function validateCancel(
  raw: Record<string, unknown>,
  lookup: ViewLookup,
): AICommand | null {
  const entityId = parseId(raw.entityId);
  if (entityId === null) return warn('cancel: invalid entityId');
  if (!lookup.myEntities.has(entityId)) {
    return warn(`cancel: entityId ${entityId} not owned`);
  }
  return { type: 'cancel', entityId };
}

// --- primitives ---------------------------------------------------------

function filterUnitIds(
  raw: unknown,
  lookup: ViewLookup,
  requiredKind?: string,
): EntityId[] {
  if (!Array.isArray(raw)) return [];
  const out: EntityId[] = [];
  for (const item of raw) {
    const id = parseId(item);
    if (id === null) continue;
    const u = lookup.myUnits.get(id);
    if (!u) continue;
    if (requiredKind && u.kind !== requiredKind) continue;
    out.push(id);
  }
  return out;
}

function parseId(raw: unknown): EntityId | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (!Number.isInteger(raw) || raw < 0) return null;
  return raw;
}

function parseInteger(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (!Number.isInteger(raw)) return null;
  return raw;
}

function parseVec2(raw: unknown): Vec2 | null {
  if (!isRecord(raw)) return null;
  const x = raw.x;
  const y = raw.y;
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  return { x, y };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function warn(msg: string): null {
  console.warn(`[nanoclaw-parser] ${msg}`);
  return null;
}
