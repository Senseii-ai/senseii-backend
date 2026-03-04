# Senseii Backend Architecture Analysis (Step 1)

## Scope

This document analyzes the current implementation of the backend in:
`/Users/prateek/Desktop/dev/personal/senseii/senseii-backend`

The goal is to capture how the system **actually works today in code**, including:
- runtime architecture,
- request flows,
- agent/tool orchestration,
- data model and persistence,
- current maturity and known architectural gaps.

---

## 1) Executive Summary

Senseii backend is a TypeScript + Express + MongoDB service with Clerk-based auth
and an OpenAI Assistants integration that is orchestrated mostly in-house.

In practice, the architecture is:
- **Layered but pragmatic**: routes -> controllers -> services -> models.
- **Thread-centric for AI state**: each goal creates/uses an OpenAI thread, plus
Mongo persistence.
- **Tool-call orchestration implemented manually**: OpenAI run stream events are
handled in custom recursive logic (`requires_action` -> execute tool -> submit
output -> continue stream).
- **Partially implemented roadmap**: core goal/chat/nutrition path exists; many
areas remain scaffolded or backlog (tests, broader route coverage, time-series design, deeper compliance).

---

## 2) Runtime and Boot Architecture

### Stack and process
- Node/Express backend (`package.json` scripts).
- TypeScript source built via `tsup`.
- MongoDB via Mongoose.
- OpenAI SDK (`openai` + AzureOpenAI config usage).
- Clerk auth middleware.

### Server startup flow
Defined in `src/server.ts`:
1. Load env and initialize Express.
2. Apply CORS, cookie/body parsers.
3. Apply Clerk middleware and custom `authenticateUser`.
4. Expose webhook and health ping.
5. Mount protected route groups:
   - `/api/vitals`
   - `/chat`
   - `/user`
6. Connect DB and start server.

### Active route surface (as mounted)
- `/api/webhooks` (Clerk webhook ingestion)
- `/ping`
- `/api-docs`
- `/api/vitals/*` (currently only a minimal subset of routes mounted)
- `/chat/*`
- `/user/*` (goal-related user profile APIs)

---

## 3) Authentication and Request Context

Auth is two-layered:
1. Clerk middleware (`clerkMiddleware`, `requireAuth`).
2. Custom middleware `authenticateUser`:
   - pulls `userId` and token from Clerk auth context,
   - stores `userId` in `AsyncLocalStorage`,
   - attaches `req.userId`.

This context propagation is architecturally important because several assistant
tool functions call `getUserId()` from middleware context instead of passing user
identity explicitly through all layers.

---

## 4) Core Product Flow in the Backend

## 4.1 Goal creation

Route: `POST /user/goals/new`

Flow:
1. Controller validates request with `createUserGoalDTO`.
2. Service creates an empty OpenAI thread.
3. Store creates:
   - new chat doc (with threadId),
   - new goal doc (linked chatId),
   - updates user profile with goalId.
4. Returns `chatId` to client.

This establishes the primary unit of conversation state: **Goal + Chat + OpenAI Thread**.

## 4.2 Streaming chat

Route: `POST /chat`

Flow:
1. Controller validates `{ content, chatId }`.
2. Opens SSE response and stream handler.
3. Service fetches chat by `(userId, chatId)` and obtains stored threadId.
4. Service appends user message to OpenAI thread.
5. Starts OpenAI run stream using core assistant id.
6. Custom stream processor:
   - forwards message deltas to SSE,
   - handles `requires_action` by executing mapped backend tool functions,
   - submits tool outputs and continues recursively.
7. Ends stream with done message.

The chat path is the architectural center of Senseii’s in-house orchestration.

## 4.3 Chat persistence and retrieval

- `POST /chat/:chatId/save` stores frontend-provided message arrays into Mongo chat document.
- `GET /chat/:chatId` returns stored chat doc.

Note: this combines OpenAI thread as live execution state with Mongo as app-level persisted state.

---

## 5) AI/Agent Orchestration Architecture

## 5.1 Assistant setup

Current assistant constants include:
- core assistant,
- nutrition assistant,
- summary assistant.

Assistant IDs are env-driven (`CORE_ASSISTANT`, `NUTRITION_ASSISTANT`, `SUMMARY_ASSISTANT`).

## 5.2 Tool registry and execution

A hardcoded map (`supportedFunctions`) binds tool names to backend handlers. Examples:
- `create_initial_goal`
- `update_user_basic_information`
- `update_eating_habits`
- `update_user_diet_preferences`
- `update_constraints`
- `update_lifestyle`
- `update_health_goals`
- `calculate_metrics`
- `create_nutrition_plan`
- `save_approved_nutrition_plan`

Execution model:
- OpenAI run event requests tools,
- backend matches tool name,
- backend function runs DB/business logic,
- output returned to run stream.

## 5.3 Structured output and validation strategy

There is a strong schema-first intent:
- Zod schemas from `@senseii/types` are used heavily.
- Some tool args use direct parse/validation.
- If args fail strict parse, fallback logic can call model-based normalization (`validateResponse`) to coerce into expected schema.

This is a notable architectural decision: using model-in-the-loop validation fallback instead of rejecting malformed tool args immediately.

## 5.4 Multi-agent reality vs intent

README describes core + nutrition + workout multi-agent collaboration.
In implementation:
- core and nutrition logic are significantly present,
- workout path is much less wired,
- summary assistant exists and is callable from service.

Overall: architecture is designed for multi-agent behavior, but current production path is mainly core-driven with nutrition generation and partial surrounding scaffolding.

---

## 6) Domain/Business Logic Layer

### Health metrics calculator

`metrics.calculator.ts` computes:
- BMI
- BMR
- TDEE
- macro targets

Inputs are sourced from persisted goal/profile slices (basic info + lifestyle + health goal).

This module is central to the “baseline metrics before plan generation” experience in the product philosophy.

---

## 7) Data Model and Persistence

Primary collections and roles:

1. `UserProfile`
- user identity profile (from Clerk webhook),
- stores `goalIds[]`.

2. `Goals`
- goal metadata,
- captured onboarding data slices:
  - basicInformation,
  - dietPreferences,
  - eatingHabits,
  - constraints,
  - lifestyle,
  - healthGoal,
- links to `chatId`,
- optional nutrition plan reference.

3. `Chats`
- userId,
- threadId (OpenAI),
- messages array.

4. `NutritionPlan`
- structured plan document with daily plan/meals/macros/micros/items.

5. `UserVitals` (+ activity/body measurement models)
- broad schema support for health records,
- route exposure currently narrower than schema breadth.

Architectural pattern: Mongo holds product state and references, while OpenAI thread is used for conversational execution continuity.

---

## 8) Webhook-Driven User Provisioning

`/api/webhooks` verifies Clerk svix signature and handles `user.created` by creating a local user profile document.

This effectively replaces legacy in-house auth signup provisioning for current architecture.

---

## 9) API Maturity: Active vs Legacy/Scaffold

Working and actively wired:
- chat streaming path,
- goal creation/listing path,
- basic vitals ingestion subset,
- Clerk webhook profile creation.

Present but partially wired or legacy:
- old credential auth controllers/services (commented out),
- thread routes/controller not mounted in main server,
- assistant route file is scaffolded,
- goals service file mostly placeholder,
- health controller empty.

This codebase is clearly in an active transition from early architecture experiments toward a narrower, practical MVP path.

---

## 10) Testing, CI/CD, and Operational State

- Build works (`npm run build` successful).
- Jest currently fails because test suite file exists but contains no tests.
- GitHub Actions workflow exists for container build and Azure web app deploy.

Interpretation:
- deployment pipeline exists,
- test maturity is low,
- production confidence currently relies more on manual validation than automated safeguards.

---

## 11) Architectural Strengths

1. Clear layer separation in most active flows.
2. Strong schema-driven mindset (Zod + typed DTOs).
3. Practical thread-based conversation continuity.
4. Explicit tool-call handling logic gives direct control over orchestration behavior.
5. Reasonable domain decomposition for goals, chats, plans, vitals.

---

## 12) Architectural Risks / Gaps

1. Duplicate/parallel orchestration paths (`openai/utils.ts` and `assistants/threads.ts`) increase drift risk.
2. Large prompt/function schema constants in code create maintainability burden.
3. Route exposure does not yet match controller/model breadth in vitals.
4. Test coverage is effectively absent today.
5. Many roadmap-critical concerns still pending (time-series strategy, richer progress tracking, compliance hardening, caching).
6. Some pieces indicate schema/flow mismatch edge risk (legacy DTO assumptions, mixed validation patterns, partial fallback behavior).

---

## 13) What Senseii Is Architecturally Today

Senseii backend today is best described as:

**A custom, in-house AI application backend that combines:**
- thread-based assistant interactions,
- hand-rolled tool execution orchestration,
- schema-first (but pragmatic) validation,
- Mongo-backed product state,
- Clerk-backed identity bootstrap.

It is not a thin wrapper around an agent framework; it is an application-specific orchestration stack with explicit control points and partial scaffolding toward a broader long-term architecture.

---

## 14) Step 1 Completion Note

This analysis establishes a practical and detailed understanding of how Senseii is currently built.  
It is ready to be used as the baseline for Step 2 (mapping to LangChain/LangGraph and identifying overlap/improvements).
