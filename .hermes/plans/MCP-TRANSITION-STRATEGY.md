# Make It Real — MCP 전환 전략 (천하삼분지계)

## 현재 상태
- 402 tests, 0 fail, 규칙 기반 플래너 삭제 완료
- src/plan/: blueprint-validator, blueprint-normalizer, claude-blueprint, artifact-assembly
- hooks: UserPromptSubmit, PreToolUse, Stop (bin/makeitreal-engine-hook 통해 실행)
- MCP: 없음

## 목표 아키텍처

### 플러그인 구조
```
plugins/makeitreal/
├── .claude-plugin/plugin.json      # 매니페스트 (유지)
├── .mcp.json                       # NEW — MCP 서버 자동시작
├── hooks/hooks.json                # 유지 (훅 등록)
├── commands/                       # 유지 (슬래시 커맨드)
│   ├── plan.md                     # 수정: mir_blueprint 도구 사용 지시
│   ├── launch.md                   # 유지
│   └── ...
├── skills/                         # 유지 (스킬)
│   ├── plan/SKILL.md               # 수정: MCP 도구 사용 지시
│   └── ...
├── mcp-server/                     # NEW — MCP 서버
│   ├── index.mjs                   # stdio 전송, 도구 등록
│   ├── tools/
│   │   ├── mir-blueprint.mjs       # 핵심: BlueprintProposal 검증+저장
│   │   ├── mir-status.mjs          # 현재 워크플로우 상태 조회
│   │   └── mir-verify.mjs          # 구현 vs 계약 검증
│   └── schemas/
│       └── blueprint-proposal.mjs  # JSON Schema (claude-blueprint.mjs에서 가져옴)
├── hooks/
│   ├── hooks.json                  # 훅 등록
│   └── (기존 훅 로직은 bin/makeitreal-engine-hook에서 유지)
└── dev-harness/                    # 엔진 소스 (유지)
```

### 데이터 흐름

```
사용자: /makeitreal:plan "build auth with JWT"
  ↓
[UserPromptSubmit 훅]
  - .makeitreal/ 상태 확인
  - 아키텍트 컨텍스트 주입 (systemMessage)
  ↓
[Claude Code]
  - 프로젝트 읽기 (Read, Glob, Grep)
  - 아키텍처 설계
  - mcp__make-it-real__mir_blueprint({...}) 호출 ← 스키마 강제!
  ↓
[MCP 서버: mir_blueprint]
  - JSON Schema 검증 (구조)
  - blueprint-validator 검증 (시맨틱: DAG 비순환, 계약 일관성)
  - blueprint-normalizer 정규화
  - artifact-assembly 아티팩트 생성 (board, trust-policy 등)
  - preview 렌더링
  - 성공: {ok: true, summary, previewUrl}
  - 실패: {ok: false, errors: [{code, reason, fix}]} ← Claude가 고쳐서 재호출
  ↓
[Claude Code]
  - 사용자에게 아키텍처 요약 표시
  - "승인하시겠습니까?"
  ↓
사용자: 승인
  ↓
[Claude Code]
  - mcp__make-it-real__mir_blueprint({...approve...}) 또는 기존 blueprint approve CLI
  ↓
/makeitreal:launch
  ↓
[PreToolUse 훅]
  - 구현 중 모듈 경계 강제
  - Write/Edit: 허용 경로 확인
  - Bash: 위험 명령 차단
  ↓
[Stop 훅]
  - 완료 시 검증: 모든 모듈 구현됐는지, 테스트 통과했는지
  - 안 됐으면 block + systemMessage
```

### MCP 도구 스키마

```
mir_blueprint:
  description: "Submit an architecture blueprint for validation and storage"
  input_schema:
    type: object
    required: [intent, architecture, responsibilityUnits, contracts, workItems]
    properties:
      intent: {goals, AC, assumptions, ...}
      architecture: {nodes, edges, style, ...}
      responsibilityUnits: [{id, label, owns, contracts, ...}]
      contracts: [{contractId, kind, provider, surface, ...}]
      workItems: [{id, title, deps, allowedPaths, ...}]
      sequences: [{title, participants, steps}]

mir_status:
  description: "Check current Make It Real workflow state"
  input_schema:
    type: object
    properties:
      projectRoot: {type: string}

mir_verify:
  description: "Verify implementation against blueprint contracts"
  input_schema:
    type: object
    required: [moduleId]
    properties:
      moduleId: {type: string}
```

## 실행 단계

### Phase 1: MCP 서버 MVP (E3)
1. mcp-server/index.mjs — stdio MCP 서버 (Node.js, zero deps)
2. mir_blueprint 도구 — blueprint-validator + normalizer + artifact-assembly 호출
3. .mcp.json — 자동 시작 설정
4. 테스트: MCP 프로토콜로 도구 호출 + 검증

### Phase 2: 스킬/커맨드 수정
1. plan SKILL.md — "mir_blueprint MCP 도구를 사용하라" 지시
2. plan.md 커맨드 — 동일
3. launch, verify 등은 기존 CLI 유지 (나중에 MCP로 전환 가능)

### Phase 3: 훅 연동
1. UserPromptSubmit — MCP 서버 상태와 동기화
2. PreToolUse — 기존 유지 (이미 잘 동작)
3. Stop — 기존 유지

### Phase 4: 운기조식
1. 풀 사이클 e2e: plan → approve → launch → implement → verify → done
2. 경계 위반 테스트
3. 에러 recovery 테스트 (잘못된 proposal → Claude 자동 수정)

## 제약
- Node.js >= 20 (기존과 동일)
- Zero external deps (기존과 동일)
- MCP 서버는 stdio 전송 (가장 간단)
- 기존 엔진 코드 최대한 재사용 (validator, normalizer, assembly)
- 기존 402 테스트 깨지면 안 됨
