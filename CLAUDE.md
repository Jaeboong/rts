# rts2 — RTS MVP

단일 플레이어 RTS 프로토타입. StarCraft 스타일 (드래그 선택 → 우클릭 명령, 채취/건설/생산/전투). **Phase 단위 검증 프로젝트** — 각 phase는 체크리스트로 끝나고, 모든 항목이 통과하기 전엔 다음 단계로 넘어가지 않는다.

## 진실의 원천 (Source of truth)

- **`docs/DESIGN.md`** — 정식 설계 + Phase 0–N 검증 체크리스트. **여기를 먼저 읽어라.**
- 본 파일 — 포인터 / 네비 인덱스. DESIGN.md 본문 내용을 중복하지 않는다.

## 코드 구조

```
src/
├── main.ts                  # bootstrap + 초기 씬 배치
├── types.ts                 # 공통 타입 + 상수 (CELL=32, GRID=64×64)
├── game/
│   ├── loop.ts              # 20Hz tick + 가변 렌더, 카메라 패닝
│   ├── world.ts             # entity store, 그리드 점유, 모달 상태(placement/attackMode)
│   ├── entities.ts          # 팩토리 + UNIT_DEFS / BUILDING_DEFS / UNIT_PRODUCTION
│   ├── camera.ts            # 월드↔스크린 좌표 + 클램프
│   ├── input.ts             # 마우스/키보드 raw 이벤트 + frame state(keys / keyDownEdges)
│   ├── selection.ts         # 박스 / hit-test
│   ├── commands.ts          # 우클릭 dispatch + UI 액션 + attack-mode 헬퍼
│   ├── handler.ts           # 프레임 입력 처리 (loop의 onUpdate)
│   ├── pathfinding.ts       # A* (binary heap, 8방향, 코너 컷 방지)
│   ├── simulate.ts          # tick 오케스트레이션
│   └── systems/
│       ├── movement.ts      # 경로 추종 + requestPath / requestPathAdjacent
│       ├── gather.ts        # Worker 상태머신 (toNode → mining → toDepot → depositing)
│       ├── production.ts    # 건물 생산 큐
│       ├── construction.ts  # 건설 진행률
│       └── combat.ts        # auto-acquire + 쿨다운 + 데미지 (attackMove 처리 포함)
└── render/
    ├── renderer.ts          # 월드 렌더 (그리드/엔티티/선택/HP/드래그박스)
    └── ui.ts                # HUD (자원/선택 패널/버튼/모드 인디케이터)
```

## 명령

| 명령 | 용도 |
|---|---|
| `npm install` | 의존성 설치 |
| `npm run dev` | Vite dev (http://localhost:5173) |
| `npm test` | vitest run (1회성) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | `tsc && vite build` (dist/) |

## 컨벤션

- TypeScript strict — `any` 금지, 에러 silencing 용 `as` 금지
- Named exports 사용. 기본 export 금지. barrel re-export 금지
- 주석은 기본적으로 쓰지 않는다. WHY가 비자명할 때만 짧게 한 줄
- **파일 ≤500줄** — 초과하면 모듈로 분리 (named export). `.claude/settings.json` 훅으로 자동 경고 (PostToolUse on Write|Edit)
- `--no-verify` / `--no-gpg-sign` / 서명 우회 절대 금지
- 새 순수 로직에는 vitest 테스트 추가. 기존 테스트 그린 유지가 기본
- 시각 검증은 사용자 몫 — 테스트/타입체크/빌드 그린 ≠ 게임이 잘 작동

## Claude로 작업 시

- **새 기능**: DESIGN.md §7 형식 phase 플랜 (목표 / 추가·수정 파일 / 검증 체크리스트) 먼저 → 사용자 승인 → 구현
- **헤드 에이전트 역할**: 진단·판단·조율은 메인 Claude가 직접. 실행(코드 편집·다중 파일 탐색·plan 초안)은 서브에이전트에 위임
  - `Explore` — 코드베이스 탐색
  - `Plan` — 신기능/리팩터 설계 초안
  - `general-purpose` — 다중 파일 구현
  - `codex:codex-rescue` — 막혔거나 2차 의견 필요 시
- **메모리**: `~/.claude/projects/C--Project-rts2/memory/MEMORY.md` (세션 간 영구 저장. 워크플로우 규칙·진행 중인 결정사항 등)
- **하네스 훅**: `.claude/settings.json` (커밋 대상). 새 세션에서는 처음 한 번 `/hooks` 메뉴 또는 재시작으로 활성화

## 알려진 한계 (Post-MVP)

- 컴퓨터 AI 없음 — 적은 정지 더미 (`enemyDummy`)
- 그룹 이동 시 formation 없음. 이동 중 자동 repath 없음
- 안개/시야, 사운드, 스프라이트, 미니맵 없음
- 키보드 단축키: Esc, A (Phase 10 attack-mode). 그 외 미구현

## 기술 스택

TypeScript strict + Vite 5 + HTML5 Canvas 2D + Vitest 1.6. **외부 게임 프레임워크 없음** — A*, 충돌, 선택 등 모두 직접 구현 (학습/검증 중심 MVP).
