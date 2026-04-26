# AI Player Infrastructure — Nanoclaw 기반 변형 계획

본 문서는 [`AI_INFRASTRUCTURE.md`](./AI_INFRASTRUCTURE.md)의 **Phase 40 대체 계획**이다.
기존은 `claude -p` (1회성 프로세스, 기억 없음)을 사용했지만, 이 변형은 **Nanoclaw 에이전트**(대화 컨텍스트 지속)를 사용한다.

Phase 38, 39 는 기존 문서와 동일하다 — Player 인터페이스 인프라는 동일하게 필요하다.
이 문서가 다루는 것은 Phase 40 의 transport/persistence 레이어 교체뿐이다.

---

## 1. 왜 Nanoclaw 인가

### 1-1. `claude -p` 의 한계

`claude -p [prompt]` 는 매번 새로운 프로세스다. 이전 호출의 결정을 전혀 기억하지 못한다. 결과:

- 5초 전에 "Barracks 짓기 시작"이라 결정해놓고, 다음 호출에서 다른 위치에 또 Barracks 명령
- 5초 전엔 공격 중이었는데 다음 호출에선 후퇴 — 게임 상태에 일관성 없는 결정
- 장기 전략(빌드오더, 정찰 결과 누적) 유지 불가

이걸 보완하려면 게임이 매번 프롬프트에 "직전 결정 히스토리"를 포함시켜야 한다 — 게임 쪽 복잡도 ↑.

### 1-2. Nanoclaw 에이전트의 차이

- 그룹별로 **대화 컨텍스트 지속** (DB 기반 메시지 히스토리)
- `groups/<name>/CLAUDE.md` 로 **장기 메모리 / 역할 정의** 가능
- 5초 전 결정을 자연스럽게 기억 → 일관성 보장

### 1-3. Trade-off

| | `claude -p` | Nanoclaw |
|---|---|---|
| 기억 지속 | ❌ | ✅ |
| 장기 전략 일관성 | 게임이 추적해서 프롬프트에 주입 | 자연스럽게 유지 |
| 인프라 의존성 | 로컬 `claude` CLI 만 | Nanoclaw 호스트 프로세스 |
| 통신 | spawn (동기) | HTTP (Nanoclaw 측 수정 필요) |
| 토큰 비용 | 매번 새 컨텍스트 | 누적 (압축 필요) |
| 응답 latency | 1–5s | 5–15s (컨텍스트 길어지면 ↑) |

Nanoclaw 쪽이 **장기 일관성**에서 결정적으로 유리하다.

---

## 2. 변경 전제 — Nanoclaw 측 수정 필요

현재 Nanoclaw 는 폴링 기반(2초 간격 DB 폴링) + IPC 만 있고 **동기 HTTP API 가 없다**.

Phase 40-A 에서 Nanoclaw 에 Express 기반 HTTP 엔드포인트를 추가한다.
이 작업은 RTS 레포 바깥(Nanoclaw 레포)에서 진행되며, Phase 40-B 의 선결 조건이다.

---

## 3. 새 아키텍처

```
                 ┌───────────────────────────────┐
                 │      Game Loop (20Hz)         │
                 │                               │
   World ──────▶ │  buildView(world, team)       │
                 │  runPlayers(players, dt) ─────┼──▶ AICommand[]
                 │  applyAICommand(world, ...)   │
                 └───────────────────────────────┘
                               ▲
              ┌────────────────┼─────────────────────┐
              │                │                     │
     ┌────────┴──────┐  ┌──────┴───────┐  ┌─────────┴─────────┐
     │ HumanPlayer   │  │ ScriptedAI   │  │ NanoclawPlayer    │
     │ (drain UI)    │  │ (sync logic) │  │ (async fetch buf) │
     └───────────────┘  └──────────────┘  └────────┬──────────┘
                                                   │
                                                   │ POST /api/nanoclaw
                                                   ▼
                                       ┌───────────────────────┐
                                       │ Vite dev plugin       │
                                       │ (proxy to Nanoclaw)   │
                                       └───────────┬───────────┘
                                                   │ POST /api/agent-message
                                                   ▼
                                       ┌───────────────────────┐
                                       │ Nanoclaw HTTP server  │
                                       │ Express + GroupQueue  │
                                       └───────────┬───────────┘
                                                   │ enqueue + await
                                                   ▼
                                       ┌───────────────────────┐
                                       │ rts-ai 그룹 컨테이너  │
                                       │ Claude Agent SDK      │
                                       │ (대화 히스토리 지속)  │
                                       └───────────────────────┘
```

**핵심 차이**: `spawn('claude','-p')` 가 사라지고, 그 자리에 **Nanoclaw HTTP 호출**이 들어간다.
Nanoclaw 의 `rts-ai` 그룹 에이전트는 같은 컨테이너/세션에서 누적 대화로 동작한다.

---

## 4. Phase 40-A — Nanoclaw HTTP API 확장

### 목표

Nanoclaw 에 동기 request/response HTTP 엔드포인트를 추가한다.
RTS 게임 전용 에이전트 그룹(`rts-ai`)을 설정한다.

### 수정 파일 (Nanoclaw 레포)

| 파일 | 작업 |
|------|------|
| `src/http-server.ts` | Express + `POST /api/agent-message` 엔드포인트 (신규) |
| `src/group-queue.ts` | `enqueueWithResponse()` — Promise 기반 응답 캡처 추가 |
| `src/container-runner.ts` | `runContainerAgent()` 가 stdout 누적 후 resolve |
| `src/index.ts` | `main()` 에서 HTTP 서버 시작 (env flag 로 토글) |
| `groups/rts-ai/CLAUDE.md` | RTS AI 역할 정의, 응답 포맷 규약, 빌드오더 가이드 |
| `groups/rts-ai/runtime-settings.json` | 모델/effort 설정 (속도 우선) |

### API 스펙

```
POST /api/agent-message
Authorization: Bearer <token>
Content-Type: application/json

Body:
{
  "groupFolder": "rts-ai",
  "message": "<게임 상태 텍스트 + 명령 요청 프롬프트>",
  "timeoutMs": 30000
}

Response (200):
{
  "success": true,
  "output": "[{\"type\":\"gather\",\"unitIds\":[5],\"nodeId\":9}, ...]"
}

Response (4xx/5xx):
{ "success": false, "error": "..." }
```

### 응답 동기화 메커니즘

1. HTTP 핸들러가 `groupQueue.enqueueWithResponse(folder, message)` 호출 → Promise 반환
2. GroupQueue 가 컨테이너 실행, stdout 캡처
3. 컨테이너 종료 시 캡처된 output 으로 Promise resolve
4. HTTP 응답 반환
5. 30초 타임아웃 안에 응답 없으면 reject + 500 반환

### `groups/rts-ai/CLAUDE.md` 핵심 내용 (초안)

```markdown
# RTS AI Player

당신은 실시간 전략 게임의 적군 AI 다.

매 호출마다 게임 상태가 텍스트로 주어진다. 당신은 **JSON 배열만** 응답한다.
설명, 펜스, 주석은 **금지**. 파싱 실패 시 명령 무시된다.

## 응답 스키마
[
  {"type":"move","unitIds":[1,2],"target":{"x":100,"y":100}},
  {"type":"gather","unitIds":[3],"nodeId":7},
  {"type":"build","workerId":4,"building":"barracks","cellX":40,"cellY":40},
  {"type":"produce","buildingId":5,"unit":"marine"}
]

## 기억할 것
- 직전에 무엇을 명령했는지 (Barracks 건설 중이면 또 명령하지 않는다)
- 자원 추이 (미네랄 부족 시 추가 워커보다 채취 효율 우선)
- 시야 정보 (적 위치 변화)

## 일반 전략
1. 워커 6기까지 채취 우선
2. SupplyDepot → Barracks → Marine 4기
3. Marine 4기 모이면 적 베이스로 attackMove
```

### 검증 체크리스트

- [ ] `POST /api/agent-message` 200 응답, 에이전트 출력 포함
- [ ] 연속 2회 호출: 두 번째 호출이 첫 번째 대화를 기억
- [ ] 30초 타임아웃 작동 (초과 시 500)
- [ ] 인증 토큰 누락 시 401
- [ ] `rts-ai` 그룹이 JSON 배열만 응답 (CLAUDE.md 규약 준수)
- [ ] 동시 요청 5개 이상 보낼 때 GroupQueue 가 직렬 처리 (그룹별 동시성 1)
- [ ] Nanoclaw 빌드/타입체크 그린

---

## 5. Phase 40-B — NanoclawPlayer + Vite bridge

### 목표

`Player` 인터페이스를 구현하는 `NanoclawPlayer` 추가.
Vite dev 플러그인이 Nanoclaw HTTP 엔드포인트를 프록시.

### 수정 파일 (RTS 레포)

| 파일 | 작업 |
|------|------|
| `vite.config.ts` | `nanoclawBridgePlugin()` — `/api/nanoclaw` → Nanoclaw 호스트 프록시 |
| `src/game/players/nanoclaw-player.ts` | async buffer 기반 Player (신규) |
| `src/game/players/prompt.ts` | `buildPrompt(view)` — view → 프롬프트 텍스트 |
| `src/game/players/parser.ts` | `parseCommands(raw, view)` — 응답 → AICommand[] |
| `src/game/players/__tests__/parser.test.ts` | fence strip / invalid JSON / stale ID 처리 |
| `src/game/players/__tests__/nanoclaw-player.test.ts` | non-blocking tick / buffer drain |
| `.env.example` | `NANOCLAW_URL`, `NANOCLAW_TOKEN` 추가 |

### `NanoclawPlayer` 핵심 구조

```ts
export class NanoclawPlayer implements Player {
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
      void this.requestCommands(view);
    }
    const drained = this.buffer;
    this.buffer = [];
    return drained;
  }

  private async requestCommands(view: GameView): Promise<void> {
    this.inFlight = true;
    try {
      const r = await fetch('/api/nanoclaw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupFolder: 'rts-ai',
          message: buildPrompt(view),
        }),
      });
      if (!r.ok) return;
      const { output } = (await r.json()) as { output: string };
      this.buffer.push(...parseCommands(output, view));
    } catch (err) {
      console.warn('[nanoclaw] request failed', err);
    } finally {
      this.inFlight = false;
    }
  }
}
```

### Vite 브릿지 플러그인

```ts
const nanoclawBridgePlugin = (): Plugin => ({
  name: 'nanoclaw-bridge',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/api/nanoclaw', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const r = await fetch(`${NANOCLAW_URL}/api/agent-message`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${NANOCLAW_TOKEN}`,
            },
            body,
          });
          const data = await r.json();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
    });
  },
});
```

### 검증 체크리스트

- [ ] `NanoclawPlayer.tick()` 이 절대 await 하지 않음 (non-blocking)
- [ ] 5초 간격으로 요청, 그 사이 tick 은 buffer drain 만
- [ ] Nanoclaw 응답 stale (60초 전 view 기반) 이라도 게임 안 죽음
- [ ] Nanoclaw 서버 다운 시 빈 명령 반환, 게임 계속 진행
- [ ] parser 가 ` ```json … ``` ` 펜스를 strip 하고 JSON 파싱
- [ ] parser 가 invalid JSON / stale entity ID 무시
- [ ] AI 가 이전 대화 컨텍스트로 일관된 빌드오더 진행 (60초 게임에서 검증)
- [ ] E2E: enemy = NanoclawPlayer 로 60초 게임 정상 진행 (crash, freeze 없음)

---

## 6. 위험 및 완화

| # | 위험 | 완화책 |
|---|---|---|
| 1 | LLM 지연이 게임 stall | producer-consumer 유지. tick 절대 block 금지. |
| 2 | LLM 이 잘못된 JSON 반환 | parser: fence strip → try/catch → schema 검증 → invalid skip. |
| 3 | LLM 이 stale entity ID 사용 | applyAICommand 모두 ID/팀/좌표 검증, 실패 시 false + warn. |
| 4 | **Nanoclaw 서버 다운** | fetch 실패 시 빈 명령 반환. 게임 종료까지 ScriptedAI fallback 옵션도 가능. |
| 5 | **대화 히스토리 폭발 (토큰 비용)** | `runtime-settings.json` 으로 `maxHistory` 제한. 5분마다 CLAUDE.md 에 요약 + 히스토리 trim. |
| 6 | **응답 latency 가 5초 초과** | NanoclawPlayer 가 inFlight 동안 추가 요청 안 보냄. 게임은 buffer drain 만. |
| 7 | **Nanoclaw HTTP API 인증 우회** | localhost-only + Bearer token. 프로덕션 빌드에서 nanoclawBridgePlugin 미포함. |
| 8 | 결정론 깨짐 → 테스트 불안정 | tests 에서는 `MockNanoclawPlayer` 로 LLM 우회. 실제 LLM 은 수동 E2E 만. |
| 9 | **Phase 40-A 가 지연되면 40-B 차단** | 40-A 와 40-B 를 병렬 진행 가능. RTS 측에서는 mock 응답 서버로 먼저 개발. |

---

## 7. 작업 순서

1. **Phase 38** — Player 인터페이스 + ScriptedAI Tier 1 (필수 인프라).
2. **Phase 39** — ScriptedAI Tier 3 (선택, 인프라 검증 + LLM 없을 때 fallback).
3. **Phase 40-A** — Nanoclaw HTTP API 확장 (Nanoclaw 레포 작업).
4. **Phase 40-B** — NanoclawPlayer + Vite bridge (RTS 레포 작업).

40-A 와 40-B 는 병렬 진행 가능 — RTS 쪽에서 mock 서버를 두고 먼저 NanoclawPlayer 를 검증할 수 있다.

---

## 8. 결정 사항 차이 요약 (vs `AI_INFRASTRUCTURE.md`)

| 항목 | 기존 (claude -p) | 변경 (Nanoclaw) |
|------|-----------------|-----------------|
| 4-1 시야 | parameterized, 기본 false | **동일** |
| 4-2 업데이트 빈도 | 5초 | **동일** |
| 4-3 잘못된 명령 | skip + warn | **동일** |
| 4-4 직렬화 포맷 | JSON + ASCII 미니맵 | **동일** |
| 4-5 결정론 | tick block 금지 | **동일** |
| 4-6 구현 순서 | ScriptedAI → Claude CLI | ScriptedAI → **Nanoclaw HTTP API → NanoclawPlayer** |
| 4-7 빌드오더 | TS data table | **동일** (ScriptedAI Tier 3) |
| 4-8 테스트 | MockClaudeCLIPlayer | **MockNanoclawPlayer** |

핵심 인프라(Phase 38, 39)와 설계 원칙은 동일하다.
변경되는 것은 **Phase 40 의 transport 레이어**(spawn → HTTP)와 **persistence 모델**(stateless → 대화 컨텍스트 지속)뿐이다.
