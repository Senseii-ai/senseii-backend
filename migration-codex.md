# Senseii Architecture and LangXYZ Migration Report

## Scope and grounding
This document is grounded in:
- `/Users/prateek/Desktop/dev/personal/senseii/senseii-backend/codex-analysis.md`
- `/Users/prateek/Desktop/dev/personal/senseii/senseii-backend/perplexity-analysis.md`
- Local docs in `/Users/prateek/Desktop/dev/personal/open-source/docs` for LangChain, LangGraph, and LangSmith.

The goal is architectural: how Senseii works today, and how it would look if built on LangChain/LangGraph/LangSmith (“LangXYZ stack”).

## Part 1: Architectural understanding of Senseii today

### 1) System boundary and runtime
Senseii backend is an Express + TypeScript service with MongoDB and Clerk auth.

Core runtime blocks:
- HTTP/API boundary in `src/server.ts`
- Authentication and identity propagation via Clerk + custom middleware
- Domain controllers/services around goals, chat, nutrition, vitals
- OpenAI Assistants-based orchestration with custom stream loop
- MongoDB as product system of record
- SSE streaming to frontend for real-time chat

### 2) Conversation-centric data model
Senseii’s primary runtime unit is effectively:
- `UserProfile` -> owns `goalIds[]`
- `Goal` -> stores onboarding slices + links to `chatId`
- `Chat` -> stores `threadId` + messages
- `NutritionPlan` -> structured plan documents

Practical implication: the product state is not “just chat.” It is a domain graph anchored on goals, with chat as execution channel and nutrition plan as downstream artifact.

### 3) Core operational flow

#### Goal initialization flow
- User creates a goal.
- Backend creates OpenAI thread.
- Backend persists Chat + Goal + UserProfile linkage.
- Frontend gets `chatId` as primary handle.

#### Chat turn flow (architectural center)
- Client sends `{content, chatId}`.
- Backend resolves `(userId, chatId)` -> thread.
- Message appended to OpenAI thread.
- Assistant run begins with SSE streaming.
- Custom recursive loop handles:
  - token deltas
  - `requires_action` tool calls
  - tool execution + output submission
  - continuation until completion

This recursive requires-action loop is the most critical “in-house orchestration asset” in current Senseii.

### 4) Agent and tool architecture
Senseii implements a multi-assistant intent, with uneven maturity:
- Core assistant: orchestrator and user-facing agent
- Nutrition assistant: specialized plan generation
- Summary assistant: utility summarization
- Fitness assistant: mostly placeholder

Tooling architecture today:
- Hardcoded function registry (`supportedFunctions`)
- Domain-specific tools for onboarding data capture, metrics, plan generation, plan approval
- Manual dispatch from tool call name -> backend handler

Validation architecture:
- Strong Zod-first design
- Pragmatic fallback: model-assisted argument normalization on malformed tool args

### 5) State and memory behavior
Today Senseii uses a hybrid memory model:
- OpenAI thread as live conversational execution state
- Mongo documents as durable product and business state

This creates power and risk:
- Power: separation between conversation mechanics and domain truth
- Risk: dual-state synchronization complexity and orchestration drift

### 6) Infrastructure and operational posture
- CI/CD and deploy pipeline exists (Azure-oriented)
- Build path works
- Test maturity is low (very limited suite quality)
- Several routes/modules remain scaffolded or partially active

### 7) Architectural strengths (current)
- Clear practical layering (route/controller/service/model)
- Strong schema mindset with shared types
- Real-time UX via SSE streaming
- Deterministic domain calculations (BMI/BMR/TDEE/macros)
- Explicit control over tool-calling loop behavior

### 8) Architectural pressure points (current)
- Manual orchestration complexity (recursive run control + tool dispatch)
- Potential drift from parallel orchestration code paths
- Growing complexity in prompt/function-schema maintenance
- Limited automated regression protection
- Partially implemented multi-agent vision vs current MVP path

## Part 2: If Senseii were built on LangXYZ (LangChain + LangGraph + LangSmith)

## A) What overlaps directly
Senseii’s current architecture already maps well to LangGraph concepts:
- OpenAI thread notion -> LangGraph thread/checkpoint model
- Custom recursive orchestration -> graph node/edge loop + ToolNode
- Manual function registry -> LangChain tools with runtime/state/store access
- SSE streaming -> LangGraph stream modes (`messages`, `updates`, `custom`)
- Multi-assistant aspiration -> subagents / handoffs / router / custom workflow patterns
- Goal/chat state continuity -> short-term memory (checkpointer) + long-term store

This is not a conceptual rewrite. It is primarily an orchestration-runtime replacement plus observability/deployment upgrade.

## B) Proposed target architecture (LangXYZ-native)

### 1) High-level layering
- API and Auth Layer: keep Express + Clerk (or equivalent existing boundary)
- Agent Orchestration Layer: LangGraph graph(s) as execution engine
- Agent Abstraction Layer: LangChain agents/tools/middleware inside graph nodes
- State Layer:
  - Thread-scoped short-term memory via checkpointer
  - Cross-thread long-term memory via store namespaces
- Domain Layer: keep existing deterministic business logic and Mongo-backed entities
- Observability/Operations: LangSmith traces, thread inspection, evaluation, deployment runtime

### 2) Primary graph topology
Recommended topology for Senseii:
- Supervisor graph (custom workflow + subagents hybrid)
- Nodes:
  - Input normalization + policy checks
  - Core conversational reasoning node (stateful)
  - Tool execution node
  - Nutrition subgraph node
  - Summary subgraph node
  - Optional workout subgraph node (future)
  - Response assembly + output streaming node
- Edges:
  - Conditional routing for domain paths (goal capture, metrics, planning, review)
  - Explicit termination conditions
  - Optional parallel fan-out where appropriate (e.g., retrieval or enrichment)

Why this shape:
- Matches current “core orchestrator + specialist workers” model
- Avoids forcing everything into one generic agent loop
- Preserves deterministic stages where needed (metrics, policy gates)

### 3) Multi-agent model selection for Senseii
Best fit is a mixed strategy:
- Base pattern: **Subagents** (core supervisor calls nutrition/workout specialists)
- Flow control: **Custom workflow** (LangGraph edges for deterministic stages)
- Selective **Handoffs** only where persona/control should transfer across turns
- **Skills** as optional progressive-context mechanism for heavy prompts

Practical recommendation:
- Keep user-facing persona with core supervisor.
- Invoke nutrition/workout as tool-subagents or subgraphs returning structured artifacts.
- Use handoff sparingly; heavy handoffs can make behavior harder to reason about.

### 4) State architecture in migrated design

#### Thread-scoped state (short-term)
- Conversation messages
- Active goal context
- Current stage (onboarding / planning / review)
- Recent tool outcomes and pending action state

Persist with checkpointer and stable `thread_id`.

#### Cross-thread state (long-term)
Use store namespaces keyed by user and application domain:
- User profile preferences
- Stable behavior constraints
- Domain memory summaries
- Reusable guidance/prompt memory

Mongo remains the product truth for canonical entities (goals, plans, vitals). Store is memory substrate, not replacement for domain DB.

### 5) Tooling architecture in migrated design
Replace manual dispatch table with typed LangChain tools:
- Domain write tools (update onboarding slices, persist approvals)
- Domain compute tools (metrics calculator remains deterministic)
- Domain generation tools (nutrition planning orchestration)
- Context-aware tools that read/write state and store via runtime

Expected benefit:
- Lower custom orchestration surface area
- Better built-in lifecycle and error semantics
- Cleaner access to state/context/store without async-local coupling

### 6) Validation and structured output in migrated design
Current Senseii relies on schema parse + LLM fallback normalization.
LangXYZ version should shift to:
- Provider-native structured output where reliable
- Tool schema enforcement at boundaries
- Tool-level validation + error policy in graph
- Optional correction/retry middleware, but explicit and bounded

This reduces hidden correction behavior and makes failure modes more auditable.

### 7) Streaming and UX in migrated design
Map current SSE behavior to graph streaming modes:
- `messages`: token-level assistant stream
- `updates`: per-node state progression (excellent for frontend “step” UX)
- `custom`: domain progress events (e.g., “calculating metrics”, “building day 3 plan”)

Senseii can preserve current real-time UX while gaining richer step visibility.

### 8) Human-in-the-loop and approvals
Today approval semantics are mostly app-defined. With LangGraph:
- Use interrupts for review/approval points (e.g., before persisting final plan)
- Resume with explicit command payloads
- Keep full checkpoint lineage for auditability and retries

This cleanly supports future compliance and clinical safety workflows.

### 9) Observability and debugging model
Replace current implicit debugging with first-class trace model:
- Run-level and trace-level introspection
- Thread-level conversation history and checkpoint history
- Metadata tagging (`userId`, `goalId`, `chatId`, environment, model version)
- Easier failure forensics and regression triage

This is one of the largest practical gains vs in-house orchestration.

### 10) Deployment/runtime model
Use LangSmith Deployment (or equivalent self-hosted Agent Server model) for:
- Durable execution
- Interrupt/resume reliability
- Background runs and scheduling
- Horizontal scaling for stateful workloads

Keep existing backend as API and domain host, with agent runtime either:
- Embedded in same service (simpler start), or
- Split as dedicated agent service with RemoteGraph integration (cleaner scaling boundary)

## C) Current-to-target mapping

| Current Senseii block | LangXYZ equivalent | Keep vs Replace |
|---|---|---|
| OpenAI Assistants thread | LangGraph thread + checkpoints | Replace runtime mechanism |
| Recursive `requires_action` stream loop | Graph execution loop + ToolNode + edges | Replace |
| Manual `supportedFunctions` dispatcher | LangChain tools + runtime injection | Replace |
| AsyncLocalStorage user context | Runtime context (`context_schema`) + state | Replace/Reduce |
| Mongo goals/chats/plans/vitals | Domain DB and canonical product data | Keep |
| Metrics calculator service | Deterministic tool/node in graph | Keep (wrap) |
| Nutrition assistant boundary | Nutrition subgraph/subagent | Keep concept, re-platform |
| Summary utility assistant | Summary node/subgraph (possibly background) | Keep concept, re-platform |
| SSE stream handler | LangGraph streaming modes via API adapter | Replace transport implementation details |
| Ad hoc observability | LangSmith traces/threads/projects | Replace/Upgrade |

## D) How the migrated system would work (end-to-end)

### Chat turn (steady state)
1. API receives user turn with auth context and thread/chat reference.
2. Graph invoked with `thread_id`, context, and input message.
3. Core supervisor node reasons over current state.
4. If tools needed, ToolNode executes domain tools with state/store access.
5. If specialization needed, route into nutrition/workout/summary subgraph.
6. State updates checkpointed at each step.
7. Stream tokens + step updates to client.
8. Final response and state persisted; domain writes committed in Mongo.

### Plan approval flow
1. Candidate plan produced and attached to state.
2. Interrupt raised for human confirmation.
3. Client submits approval/revision.
4. Graph resumes from checkpoint and either saves plan or loops revision path.

### Failure and retry behavior
- Node/tool failures can retry with policy.
- Interrupted or crashed runs resume from last durable checkpoint.
- No need to replay full conversation from scratch manually.

## E) What should stay in-house even after migration
- Domain models and product schema decisions
- Deterministic health calculations and scientific formulas
- Business invariants, policy checks, and safety constraints
- API contracts with frontend and third-party systems
- Data governance/compliance controls

LangXYZ should replace orchestration plumbing, not core product intelligence.

## F) Practical migration shape (recommended)

### Phase 1: Runtime alignment
- Keep current API and Mongo model.
- Introduce LangGraph for the core chat loop only.
- Map existing tools and schemas first, without changing product behavior.

### Phase 2: Specialist re-platforming
- Convert nutrition and summary into subgraphs/subagents.
- Add explicit state contracts and routing edges.
- Introduce checkpointer-backed durable execution in non-dev environments.

### Phase 3: Memory and operations maturity
- Introduce long-term memory store namespaces for cross-thread preferences.
- Add message summarization/lifecycle middleware for long threads.
- Add LangSmith tracing metadata standards and evaluation workflow.

### Phase 4: Advanced orchestration
- Introduce interrupts for approvals and critical actions.
- Split into dedicated deployment topology if scale/latency isolation demands it.

## G) Net assessment
If Senseii were built on LangXYZ from scratch, the biggest changes would be:
- Less custom orchestration code
- More explicit, inspectable state machine behavior
- Stronger durability and HITL support
- Better production observability and debugging

The core product architecture (goals, onboarding slices, nutrition planning, deterministic metrics, Mongo-centric domain data) would remain largely the same.

So this is best viewed as an **orchestration/runtime migration**, not a complete product architecture rewrite.
