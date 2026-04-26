# Phase 53 — Standalone Map Editor (separate page)

## Goal
Standalone web page at `http://localhost:5173/editor.html` for designing rts2 maps. Click-paint tiles, click-place entities, save/load JSON. Separate Vite entry, **does NOT share game runtime** (no game tick, no AI, no combat).

## Why separate page (not F11 toggle)
- Cleaner code separation (editor doesn't touch `src/game/` runtime)
- Natural for "design a new map from scratch" workflow
- Multi-page Vite pattern already established (`index.html` + `admin.html`)

## Read first (do not modify)
- `vite.config.ts` — multi-page entry pattern
- `src/types.ts` — TileKind, EntityKind, BuildingKind, GRID_W=GRID_H=256, CELL=16, WORLD_W=WORLD_H=4096
- `src/game/world.ts` — `world.tiles: TileKind[]` shape (length 256*256)
- `src/game/map/index.ts` — preset exports (`expansionFrontPreset`, `westernFrontPreset`)
- `src/game/map/presets/expansion-front.ts` — preset shape (`generate(seed) → { tiles, spawns: SpawnDescriptor[] }`)
- `src/render/sprites.ts` — sprite atlas loader
- `src/render/tile-render.ts` — tile drawing
- `src/game/camera.ts` — Camera shape, panBy, screenToWorld, worldToScreen
- `index.html` — pattern for canvas + module script

## Files to ADD (rts2)
- `editor.html` — minimal HTML: full-window canvas + side panel + module script (`type="module" src="/src/editor/main.ts"`)
- `src/editor/main.ts` — bootstrap (createCanvas, init editor state, mount UI, start render loop using requestAnimationFrame)
- `src/editor/editor-state.ts` — Module-scope state: tool ('paint'|'place'|'erase'), selectedTile (TileKind), selectedEntity (kind+team), camera, tiles array (256*256 init grass-1), entities (array of {kind, team?, cellX, cellY, remaining?})
- `src/editor/editor-render.ts` — Render tiles + entity dots/sprites at scale, viewport rect, hover highlight cell. Use existing `tile-render.ts` if compatible; otherwise simple colored squares per TileKind.
- `src/editor/editor-input.ts` — Mouse click/drag → paint cell or place entity; right-click erase; WASD/arrow pan camera. Cell coords from `screenToWorld` + `Math.floor(px / CELL)`.
- `src/editor/editor-palette.ts` — Side panel UI (HTML overlay, NOT canvas): tool buttons, tile/entity palette, save/load buttons, current cursor cell display
- `src/editor/editor-io.ts` — Serialize state to JSON (download via `URL.createObjectURL` + `<a download>`); deserialize from File input
- `src/editor/editor.test.ts` — Pure logic tests: paint at cell mutates tiles array; place entity adds to entities; erase removes; JSON roundtrip preserves state.

## Files to MODIFY (rts2 — minimal)
- `vite.config.ts` — add `editor: resolve(__dirname, 'editor.html')` to `build.rollupOptions.input` (1 line addition)
- **DO NOT touch** any other game/render file. Reuse via import only.

## JSON format (default decision — locked in)
```json
{
  "version": 1,
  "name": "untitled",
  "gridW": 256,
  "gridH": 256,
  "tiles": ["grass-1", "grass-1", "wall-stone", "..."],
  "entities": [
    { "kind": "commandCenter", "team": "player", "cellX": 13, "cellY": 218 },
    { "kind": "mineralNode", "cellX": 17, "cellY": 220, "remaining": 1500 }
  ]
}
```
Plain array for tiles (no RLE). Length = gridW * gridH = 65536. Entities: only kind, team (if applicable), cellX, cellY, remaining (mineralNode only). Other entity properties ignored — game preset infers from kind on load.

## Editor UI sketch (HTML overlay, fixed right 240px panel)
```
┌── Map Editor ──────┐
│ [New blank]        │
│ [Load preset ▾]    │  → western-front / expansion-front
│ [Load JSON…]       │  → file input
│ ─── Tools ────     │
│ [Paint] [Place] [Erase]
│ ─── Tiles ─────    │
│ ◯ grass-1          │
│ ◯ wall-stone       │
│ ◯ water            │
│ ◯ road-dirt        │
│ ─── Entities ───   │
│ ◯ mineralNode      │
│ ◯ gasGeyser        │
│ ◯ CC (player)      │
│ ◯ CC (enemy)       │
│ ◯ supplyDepot      │
│ ─── Save ──────    │
│ [Download JSON]    │
│ Cell: (123,45)     │
└────────────────────┘
```
Click tool button → switch mode. Click tile/entity → select. Click canvas → apply.

## Default decisions (do NOT ask user)
- **Tile palette**: grass-1, wall-stone, water, road-dirt (4 most common; expand later)
- **Entity palette**: mineralNode, gasGeyser, commandCenter (player/enemy as 2 separate buttons), supplyDepot (5 buttons total)
- **Initial state on load**: all tiles = grass-1, no entities, camera at (0,0)
- **Paint mode**: single click + drag both work (record mousedown, paint on every mousemove until mouseup)
- **Place mode**: single click only (no drag-place — would spam-place too easily)
- **Erase mode**: right-click on canvas removes the topmost entity at that cell, OR if no entity, paints the cell to default grass-1
- **Camera pan speed**: 600 px/sec same as game
- **Sprite atlas load**: lazy via existing `loadSprites`. If load fails, fall back to colored-square rendering per TileKind / per entity kind. Don't crash.
- **Validation on placement**: NONE. Editor is for design — let user place anywhere. Validation happens at game-load time.
- **JSON file name**: `<name || 'map'>.json` — name from a side-panel text input that defaults to "untitled"
- **Multiple CC same team**: allowed (editor allows, game treats as expansion)
- **Multiple mineral remaining values**: locked at 1500 (SC standard); future: expose in palette

## Constraints
- TypeScript strict, no `any`, no `as` for silencing, named exports
- Files ≤500 lines (split palette / state / input / render / io)
- Editor doesn't run game tick — pure render loop, draw tiles + entity dots/sprites + hover highlight
- Don't touch game files (`src/game/`, `src/render/`) — only ADD new editor files. Reuse via import.
- Don't commit (worktree branch is fine to create, just don't push)

## Acceptance
1. `npm run typecheck` clean
2. `npm test` — pre-existing 3 failures only (`displaceUnitsFromFootprint`, `getRallyVisualizations`, `computePlacementPreview`)
3. `npm run build` clean (BOTH game and editor entries build)
4. Manual trace (you state intent, don't actually browse): navigate `http://localhost:5173/editor.html` → page loads with empty 256×256 grass grid + side panel → click "Load preset → expansion-front" → preset tiles + entities render → click "Paint" + "wall-stone" → drag → tiles change → click "Save" → JSON downloads.

## Out of scope (future phases)
- Tile palette beyond 4 common kinds (cliffs, doodads, etc.)
- Map editor for unit placement (worker stamps) — only buildings/resources for v0
- Undo/redo (out of scope — save often)
- Map metadata editor (description, author) — just `name` field for now
- Visual symmetry helper (mirror across diagonal) — manual placement only
- In-game preset registry hot-reload — load JSON only via file input

## Constraints (specific to Codex run)
- **CDP MCP (Chrome DevTools Protocol MCP) 절대 사용 금지** — 브라우저 자동화/DOM 접근/스크린샷 일체 금지
- 빌드 실패 시 그 상태에서 멈추고 보고 — 무한 troubleshoot 금지
- 호스트 sandbox와 충돌 시 호스트 검증으로 위임 (보고만 하고 멈춤)
