# Make It Real — Visual Overhaul Plan

## Goal
대시보드를 "유명 오픈소스 SDK 문서급" 비주얼로 올리기.
GitHub 10k star 첫인상.

## Current State (60%)
- 433 tests, zero deps, engine solid
- 8 views working (Overview, Architecture, Tasks, Contracts, Approval, Surfaces, Scenarios, Reviews)
- Linear design system applied (tokens, Icons.tsx, EmptyState, responsive)
- README rewritten (167L)

## What Needs to Happen

### Phase 1: Foundation (shadcn + Tailwind)
- [ ] Setup Tailwind CSS 4 in src/dashboard/app/
- [ ] Setup shadcn/ui (init + base components)
- [ ] Migrate existing global.css tokens to Tailwind theme

### Phase 2: AI Elements Integration
- [ ] `npx ai-elements@latest add canvas` — workflow diagrams
- [ ] `npx ai-elements@latest add schema-display` — contract surfaces
- [ ] `npx ai-elements@latest add plan` — task planning
- [ ] `npx ai-elements@latest add code-block` — syntax highlighting
- [ ] `npx ai-elements@latest add file-tree` — project structure
- [ ] `npx ai-elements@latest add confirmation` — approval dialogs
- [ ] `npx ai-elements@latest add queue` — task queue

### Phase 3: Graph Layout (ELK.js)
- [ ] Replace dagre with ELK.js in TopologyGraph
- [ ] Replace dagre with ELK.js in TaskDAG
- [ ] Configure layered (Sugiyama) layout for architecture
- [ ] Test with auth-system (6 work items, real DAG)

### Phase 4: Mermaid Custom Theme
- [ ] Add mermaid.js for sequence diagrams
- [ ] Custom dark theme matching dashboard palette
- [ ] Replace CSS sequence diagrams in ScenarioView

### Phase 5: Component Rewrite
- [ ] HeroSection → AI Elements Plan + Queue
- [ ] ContractSurfacesView → AI Elements Schema Display
- [ ] TopologyGraph/TaskDAG → AI Elements Canvas + Node + Edge
- [ ] ResponsibilityMap → AI Elements File Tree + cards
- [ ] KanbanBoard → shadcn cards + AI Elements Task

### Phase 6: Polish
- [ ] View transitions (page-level animations)
- [ ] Skeleton loading states
- [ ] Responsive final pass
- [ ] Light/dark mode toggle with AI Elements theming

### Phase 7: Cleanup
- [ ] Deprecate/remove render-dashboard-html.mjs (3735L)
- [ ] Remove preview/ static generation from pipeline
- [ ] Update `design render` to only serve via dashboard

## Remaining for 10k Star
- [ ] asciicast GIF for README
- [ ] npm publish / distribution
- [ ] Full cycle e2e (plan→launch→code→verify→Done)
- [ ] docs internal cleanup

## Military Structure
- Hermes (스피키) = 총사령관 — 감독, 검증, 디스패치
- Claude Code (호랑이선생님) = 디자인 아키텍트 — 가이드, 리뷰
- Claude CLI (코딩노예) = 구현 닌자 — 병렬 투입
