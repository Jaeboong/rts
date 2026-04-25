# AI Player Infrastructure 설계 문서

본 문서는 적 진영을 정적 더미에서 **실제로 행동하는 AI**로 전환하기 위한 인프라 설계서다.
최종 목표는 `claude -p` 외부 프로세스를 적 AI 플레이어로 부착하는 것. 단, 그 전에 결정론적 ScriptedAI를 먼저 구축해 인프라(Player 인터페이스, 명령 적용, 시야 직렬화, 결정론 보장)를 검증한다.

## 1. 핵심 통찰

게임 루프와 LLM의 **시간 스케일 불일치**가 모든 설계 결정의 출발점이다.

- 시뮬레이션 tick: **20Hz (50ms)**, fixed-step.
- LLM 응답 시간: **1–5초** (claude -p 호출 + 모델 추론).
- 비율: tick 1번 동안 LLM은 응답 1/100도 못 만든다.

**해결**: producer-consumer 패턴. Player 는 명령을 *생산*하고, Game tick 은 명령 큐를 *소비*한다.

- HumanPlayer: UI 입력 큐를 매 tick 즉시 drain (latency 0).
- ScriptedAI: 매 tick 동기 실행 (latency 0).
- ClaudeCLIPlayer: 비동기 fetch → 응답 도착 시 큐에 push, tick 은 가용분만 drain.

**절대 원칙**: Player.tick 은 **non-blocking**. 어떤 플레이어도 게임 루프를 stall 시킬 수 없다.
LLM 응답이 5초 걸리면 그동안 게임은 정상 진행되고, 응답 도착 후 한 번에 큐에 쌓인 명령이 적용된다.

## 2. 아키텍처

```
                ┌──────────────────────────────┐
                │      Game Loop (20Hz)        │
                │                              │
   World ──────▶│  buildView(world, team)      │──▶ GameView (per-team snapshot)
                │                              │
                │  runPlayers(players, dt) ────┼──▶ AICommand[]
                │                              │
                │  applyAICommand(world, ...)  │──▶ World mutations
                │                              │
                │  Systems: Movement / Combat  │
                │           Gather / Production│
                │           Construction       │
                └──────────────────────────────┘
                            ▲
            ┌───────────────┼───────────────────────┐
            │               │                       │
   ┌────────┴──────┐  ┌─────┴────────┐  ┌──────────┴────────┐
   │ HumanPlayer   │  │ ScriptedAI   │  │ ClaudeCLIPlayer   │
   │ (drain UI)    │  │ (sync logic) │  │ (async fetch buf) │
   └───────────────┘  └──────────────┘  └─────────┬─────────┘
                                                  │
                                                  │ POST /api/claude
                                                  ▼
                                       ┌─────────────────────┐
                                       │ Vite dev plugin     │
                                       │ spawn('claude','-p')│
                                       └─────────────────────┘
```

기존 입력 시스템(`commands.ts`)은 **HumanPlayer 안에 캡슐화**되며, AICommand 를 발행하는 형태로 wrap 된다.
이렇게 하면 기존 동작은 보존되고, 새 Player 들은 동일 인터페이스로 추가된다.

## 3. TypeScript 인터페이스

```ts
// src/game/players/types.ts

export interface Player {
  readonly team: Team;
  /** Called every tick. Must be non-blocking. */
  tick(view: GameView, dt: number): AICommand[];
  /** Optional: serialize view to LLM-friendly text. */
  serialize?(view: GameView): string;
}

export interface GameView {
  readonly tick: number;
  readonly resources: { minerals: number };
  readonly myEntities: readonly ViewEntity[];
  readonly visibleEnemies: readonly ViewEntity[];
  readonly visibleResources: readonly ViewEntity[];
  readonly mapInfo: { w: number; h: number; cellPx: number };
}

export interface ViewEntity {
  readonly id: EntityId;
  readonly kind: string;
  readonly team: Team;
  readonly pos: Vec2;
  readonly hp: number;
  readonly maxHp: number;
  readonly cellX?: number;
  readonly cellY?: number;
  readonly underConstruction?: boolean;
  // 의도적으로 path/attackCooldown/repathTimer 등 내부 상태는 제외
}

export type AICommand =
  | { type: 'move';        unitIds: EntityId[]; target: Vec2 }
  | { type: 'attack';      unitIds: EntityId[]; targetId: EntityId }
  | { type: 'attackMove';  unitIds: EntityId[]; target: Vec2 }
  | { type: 'gather';      unitIds: EntityId[]; nodeId: EntityId }
  | { type: 'build';       workerId: EntityId; building: BuildingKind; cellX: number; cellY: number }
  | { type: 'produce';     buildingId: EntityId; unit: UnitKind }
  | { type: 'setRally';    buildingId: EntityId; pos: Vec2 }
  | { type: 'cancel';      entityId: EntityId };

export function buildView(world: World, team: Team): GameView;
export function applyAICommand(world: World, team: Team, cmd: AICommand): boolean;
export function runPlayers(world: World, players: readonly Player[], dt: number): void;
```

`applyAICommand` 는 명령이 **이 팀이 발행할 수 있는지** 검증한다 — 다른 팀 유닛 조작 차단, 죽은 엔티티 ID 차단, 셀 범위 검사. 잘못된 명령은 `false` 반환 + 로그.

## 4. 결정 사항 (8가지)

### 4-1. 시야(Fog of War)
- **결정**: parameterized, 기본 `false` (전체 시야).
- **이유**: MVP 는 fog 없음. 미래 LLM 현실성을 위해 hook 만 미리 둔다.
- **구현**: `buildView` 가 `{ fog: boolean }` 옵션을 받는다. `fog=true` 일 때만 `sightRange` 로 필터.

### 4-2. 업데이트 빈도
- **결정**: 플레이어별로 다르게.
  - HumanPlayer: 매 tick (입력 즉시 반영).
  - ScriptedAI: 매 tick (결정론적이라 cost 무시 가능).
  - ClaudeCLIPlayer: **N초마다 1회** (기본 5초). tick 은 매번 호출되지만 buffer drain 만.
- **이유**: 50ms tick 마다 LLM 호출은 비용·rate-limit 둘 다 폭발.

### 4-3. 잘못된 명령 처리
- **결정**: skip + warn-log. 절대 throw 하지 않음.
- **이유**: LLM 은 stale ID, 잘못된 좌표, 중복 명령을 자주 낸다. 게임이 죽으면 안 됨.
- **구현**: `applyAICommand` 안에서 모든 검증 → 실패 시 `console.warn` + return `false`.

### 4-4. LLM 직렬화 포맷
- **결정**: JSON (entity 목록) + ASCII 미니맵.
- **이유**: JSON 만으로는 공간 관계가 불명확. 미니맵으로 위치를 보강.
- **포맷 예시**:
  ```
  Tick: 240
  Minerals: 350
  Map: 64x64 cells
  
  My units:
  - id=12 worker at (5,5) hp=40/40
  - id=13 marine at (8,6) hp=60/60
  
  Enemy units:
  - id=99 enemyDummy at (40,40) hp=100/100
  
  Minimap (M=mine, E=enemy, R=resource, .=empty):
  .....M..............R.....
  .....M.M............R.....
  .........................E
  ```

### 4-5. 결정론
- **결정**: tick 절대 block 금지. 응답 미도착 시 빈 명령 반환.
- **이유**: 결정론 + 테스트 가능성. mock 가능한 Player 로 시뮬레이션 재현 가능.
- **구현**: ClaudeCLIPlayer 의 `inFlight` 플래그 + 비동기 resolve.

### 4-6. 구현 순서
- **결정**: ScriptedAI Tier 3 → Claude CLI.
- **이유**: ScriptedAI 가 인프라(view 직렬화, 명령 적용, runPlayers 통합)를 모두 검증한다.
  Claude CLI 는 그 위에 transport 레이어만 얹는 구조.
- **위험 회피**: LLM 디버깅 + 인프라 디버깅 동시에 하지 않는다.

### 4-7. 빌드 오더 표현
- **결정**: TS data table (`build-orders.ts`).
- **이유**: 코드에 박으면 튜닝마다 컴파일. 데이터로 빼면 hot-reload.
- **구조**:
  ```ts
  export const TIER3_BUILD_ORDER: readonly BuildStep[] = [
    { at: 0,    action: 'produce', kind: 'worker', building: 'commandCenter' },
    { at: 30,   action: 'build',   kind: 'supplyDepot' },
    { at: 60,   action: 'build',   kind: 'barracks' },
    { at: 90,   action: 'produce', kind: 'marine',  building: 'barracks' },
    { at: 120,  action: 'wave',    composition: { marine: 4 }, target: 'enemyBase' },
  ];
  ```

### 4-8. 테스트 전략
- **결정**: 결정론적 시뮬레이션 + mocked LLM.
- **MockClaudeCLIPlayer**: 미리 정해진 명령 시퀀스를 buffer 에 push. fetch 호출 안 함.
- **검증**:
  - applyAICommand: 각 명령 타입별 unit-test (move, attack, build, produce, gather…).
  - buildView: snapshot test (특정 world → 특정 view JSON).
  - runPlayers: 2 player 통합 테스트 (Human vs ScriptedAI 5분 결정론 시뮬).
  - parser: markdown fence strip + 잘못된 JSON 무시.

## 5. Phase 분해

### Phase 38 — Player 인터페이스 + ScriptedAI Tier 1

**목표**
Player 인터페이스 도입. HumanPlayer 가 기존 입력을 wrap. ScriptedAI Tier 1 = 워커만 만들어 미네랄 채취 (전투 없음). 기존 동작 100% 보존.

**추가·수정 파일**
- `src/game/players/types.ts` — interface Player, GameView, AICommand.
- `src/game/players/view.ts` — `buildView(world, team, opts?)`.
- `src/game/players/command-applier.ts` — `applyAICommand(world, team, cmd)`.
- `src/game/players/human-player.ts` — 기존 commands.ts 를 호출하는 wrap.
- `src/game/players/scripted-ai.ts` — Tier 1 로직 (워커 생산 + 채취만).
- `src/game/players/runner.ts` — `runPlayers(world, players, dt)`.
- `src/game/loop.ts` — Player 리스트 보유 + tick 마다 `runPlayers` 호출.

**검증 체크리스트**
- [ ] HumanPlayer 만 등록한 상태에서 게임 동작이 변경 없음 (회귀 테스트).
- [ ] enemy 팀에 ScriptedAI Tier 1 부착 시 시작 워커가 자동 채취.
- [ ] applyAICommand: 잘못된 팀의 유닛 조작 시 false + warn.
- [ ] buildView: snapshot test 통과.
- [ ] 기존 테스트 전부 green.

---

### Phase 39 — ScriptedAI Tier 3 (build order + waves)

**목표**
ScriptedAI 를 실제로 위협이 되는 수준까지: CC → SD → Barracks → Marine 빌드오더 + 일정 간격으로 attack wave.

**추가·수정 파일**
- `src/game/players/scripted-ai.ts` — state machine 확장.
- `src/game/players/build-orders.ts` — TIER3_BUILD_ORDER 데이터 테이블.
- `src/game/players/strategy.ts` — wave timing, target 선정 로직.

**검증 체크리스트**
- [ ] enemy AI 가 60초 내 Barracks 완성.
- [ ] 120초 시점에 Marine 4기 wave 가 플레이어 베이스로 진군.
- [ ] 결정론 시뮬레이션 5분 → 예상 entity 카운트 일치.
- [ ] AI vs AI 매치에서 어느 한쪽이 패배 (무한 루프 없음).

---

### Phase 40 — ClaudeCLIPlayer + Vite bridge

**목표**
`claude -p` 외부 프로세스를 enemy AI 로 부착. dev 서버에서만 동작.

**추가·수정 파일**
- `vite.config.ts` — `claudeBridgePlugin()` 추가.
- `src/game/players/claude-cli-player.ts` — async buffer 기반 Player.
- `src/game/players/prompt.ts` — view → prompt string.
- `src/game/players/parser.ts` — LLM raw text → AICommand[].
- `src/game/players/__tests__/parser.test.ts` — fence strip, invalid JSON 처리.

**검증 체크리스트**
- [ ] `POST /api/claude` 가 200 + JSON 응답.
- [ ] ClaudeCLIPlayer 가 5초 간격으로 요청, 그 사이 tick 은 buffer drain 만.
- [ ] LLM 응답 stale (60초 전 view 기반) 이라도 게임 안 죽음.
- [ ] parser 가 ` ```json … ``` ` 펜스를 strip 하고 JSON 파싱.
- [ ] E2E: enemy = ClaudeCLIPlayer 로 60초 게임 정상 진행 (crash, freeze 없음).

## 6. 위험 및 완화

| # | 위험 | 완화책 |
|---|---|---|
| 1 | LLM 1–5s 지연이 게임 stall | producer-consumer + 절대 block 금지. tick 매번 동기 drain. |
| 2 | LLM 이 잘못된 JSON 반환 | parser: fence strip → JSON.parse try/catch → schema 검증 → invalid skip. |
| 3 | LLM 이 stale entity ID 사용 | applyAICommand 모두 ID/팀/좌표 검증, 실패 시 false + warn. |
| 4 | ScriptedAI Tier 3 이 너무 약함 | build-order 를 데이터 테이블로 분리, 반복 튜닝. |
| 5 | spawn('claude') 보안 | bridge plugin 은 dev mode + localhost only. 프로덕션 빌드에서 미포함. |
| 6 | 토큰 비용 폭발 | view 압축: 시야 내 entity 만 + ASCII 미니맵 + 5s throttle. |
| 7 | 결정론 깨짐 → 테스트 불안정 | tests 에서는 MockClaudeCLIPlayer 로 LLM 우회. 실제 LLM 은 수동 E2E 만. |
| 8 | Windows 에서 spawn 'claude' 실패 | shell:true + claude.cmd 탐색. PATH 못 찾으면 명확한 에러 메시지. |

## 7. CLI 통합 — 구현 스케치

### 7-1. Vite dev 플러그인

```ts
// vite.config.ts
import type { Plugin } from 'vite';
import { spawn } from 'node:child_process';

const claudeBridgePlugin = (): Plugin => ({
  name: 'claude-bridge',
  apply: 'serve', // dev only
  configureServer(server) {
    server.middlewares.use('/api/claude', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        return res.end();
      }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const child = spawn('claude', ['-p', body], {
          timeout: 30_000,
          shell: process.platform === 'win32',
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', c => { stdout += c; });
        child.stderr.on('data', c => { stderr += c; });
        child.on('close', (code) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: code === 0, output: stdout, stderr }));
        });
        child.on('error', (err) => {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: err.message }));
        });
      });
    });
  },
});
```

### 7-2. ClaudeCLIPlayer

```ts
// src/game/players/claude-cli-player.ts
export class ClaudeCLIPlayer implements Player {
  readonly team: Team;
  private buffer: AICommand[] = [];
  private inFlight = false;
  private lastRequestMs = 0;
  private readonly intervalMs: number;

  constructor(team: Team, opts: { intervalMs?: number } = {}) {
    this.team = team;
    this.intervalMs = opts.intervalMs ?? 5000;
  }

  tick(view: GameView, _dt: number): AICommand[] {
    const now = performance.now();
    if (!this.inFlight && now - this.lastRequestMs > this.intervalMs) {
      this.lastRequestMs = now;
      void this.requestCommands(view); // fire-and-forget
    }
    const drained = this.buffer;
    this.buffer = [];
    return drained;
  }

  private async requestCommands(view: GameView): Promise<void> {
    this.inFlight = true;
    try {
      const prompt = buildPrompt(view);
      const r = await fetch('/api/claude', {
        method: 'POST',
        body: prompt,
        headers: { 'Content-Type': 'text/plain' },
      });
      if (!r.ok) return;
      const { output } = (await r.json()) as { output: string };
      const cmds = parseCommands(output, view);
      this.buffer.push(...cmds);
    } catch (err) {
      console.warn('[claude-cli] request failed', err);
    } finally {
      this.inFlight = false;
    }
  }
}
```

### 7-3. Parser

```ts
// src/game/players/parser.ts
export function parseCommands(raw: string, view: GameView): AICommand[] {
  // ```json … ``` 또는 ``` … ``` 펜스 strip
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/m.exec(raw);
  const body = fence ? fence[1] : raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const valid: AICommand[] = [];
  for (const item of parsed) {
    const cmd = validateCommand(item, view);
    if (cmd) valid.push(cmd);
  }
  return valid;
}

function validateCommand(raw: unknown, view: GameView): AICommand | null {
  // type-narrow + view 의 entity ID 검증
  // 실패 시 null
  // (구현 상세는 Phase 40 에서)
}
```

### 7-4. Prompt 템플릿 (초안)

```ts
// src/game/players/prompt.ts
export function buildPrompt(view: GameView): string {
  return [
    `You are an enemy AI in a real-time strategy game.`,
    `Tick: ${view.tick}, Minerals: ${view.resources.minerals}`,
    ``,
    `My units (${view.myEntities.length}):`,
    ...view.myEntities.map(formatEntity),
    ``,
    `Visible enemies (${view.visibleEnemies.length}):`,
    ...view.visibleEnemies.map(formatEntity),
    ``,
    `Map: ${renderMinimap(view)}`,
    ``,
    `Reply with a JSON array of commands. Schema:`,
    `[{type:'move', unitIds:[...], target:{x,y}}, ...]`,
    `Valid types: move, attack, attackMove, gather, build, produce, setRally, cancel.`,
    `Return ONLY the JSON array. No commentary.`,
  ].join('\n');
}
```

## 8. 작업 순서 요약

1. **Phase 38** 마무리 (이번 phase 의 mineral/depot refactor 완료 후 시작).
2. **Phase 39** ScriptedAI Tier 3 — 실제 적이 행동하기 시작.
3. **Phase 40** ClaudeCLIPlayer — 외부 프로세스 부착, 수동 E2E 검증.

각 phase 는 독립적으로 검증 가능하며, Phase 39 까지만으로도 enemy AI 는 의미 있게 동작한다. Phase 40 은 "Claude 가 RTS 를 플레이한다" 는 데모 가치를 위한 단계.
