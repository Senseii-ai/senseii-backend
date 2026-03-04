# Senseii → LangChain / LangGraph Migration (Architectural Comparison)

This document has two jobs:
- First, describe **what blocks make Senseii work today** – at the level of
agents, orchestration, phases, and infrastructure.
- Then, describe **how those same responsibilities would look** if Senseii were
built on the LangChain + LangGraph stack ("langxyz"), purely at an architectural
/ conceptual level (no code).

---

## 1. Senseii Today — Architectural Blocks

This section compresses `codex-analysis.md` + `perplexity-analysis.md` into a
component-level view of how Senseii is actually implemented. [cite:19][cite:21]

### 1.1 Product-level mental model

Senseii is a **goal-centric, multi-agent health coach**:
- Users define a health/fitness goal (lose weight, gain muscle, improve cardio).
- A "Japanese Sensei"-like Core assistant onboards them, asks questions, and
explains things.
- Behind the scenes, domain assistants generate plans and metrics, and the system
persists state for long-term tracking. [cite:19][cite:21]

In practice, everything revolves around a **Goal + Chat + Thread** triple:
- A **Goal** captures what the user wants and their evolving profile (basic info,
lifestyle, diet preferences, constraints, health goals).
- A **Chat** captures conversational history for that goal.
- An **OpenAI Thread** (Assistants API) is the LLM-side state for that goal’s
conversation. [cite:19]

### 1.2 High-level blocks

You can think of today’s backend as six major blocks working together. [cite:19][cite:21]

| Block | What it is | What it does |
| --- | --- | --- |
| A. API & Auth | Express + Clerk | HTTP endpoints, SSE for streaming, auth and user identity propagation. [cite:19] |
| B. Conversation Engine | Chat routes/controllers + SSE handlers | Accepts user messages, opens SSE streams, forwards work to the AI layer. [cite:19] |
| C. Agent Orchestrator | OpenAI Assistants + custom tool engine | Core assistant, nutrition & summary assistants, tool invocation, recursive stream handling. [cite:19][cite:21] |
| D. Domain Services | Nutrition planner, metrics calculator, goal & profile services | Deterministic metrics, nutrition plan generation, persistence logic. [cite:15][cite:16] |
| E. Persistence | MongoDB (UserProfile, Goals, Chats, NutritionPlan) | Long-term state and linkage between users, goals, chats, and plans. [cite:16] |
| F. Provisioning | Clerk webhook → UserProfile | Turns an external user into an internal profile with a place to store goals and chats. [cite:17][cite:16] |

These blocks are wired manually with TypeScript, not through any orchestration framework. [cite:19]

### 1.3 Agents and their orchestration (today)

Senseii’s "multi-agent" behavior comes from **multiple OpenAI assistants + internal services**, not from a high-level agent framework. [cite:21]

- **Core Assistant (Sensei persona)**
  - Only assistant that speaks directly to the user.
  - Uses a long, opinionated system prompt to define personality and responsibilities.
  - Has ~10 **function tools** attached (update user basic info, update lifestyle, diet preferences, constraints, health goals, calculate metrics, create initial goal, create nutrition plan, save approved plan, etc.). [cite:10][cite:11]
  - Decides, via the model, **when** to call which tool during a run.

- **Nutrition Assistant**
  - Separate LLM persona focused on 7-day nutrition plans.
  - Implemented via `chat.completions.parse` with a Zod schema, returning a structured `NutritionPlan` object matching the DB shape. [cite:12]
  - Typically triggered indirectly via a Core-assistant tool (`create_nutrition_plan`).

- **Summary Assistant**
  - Utility assistant that summarizes an existing thread into a 2–3 word title.
  - Works on the same OpenAI thread, then deletes its own messages from that thread after use. [cite:13]

- **Fitness Assistant**
  - Persona and instructions exist, but orchestration is mostly WIP/not wired into the main flow yet. [cite:13]

**Orchestration style today**:
- The **Core Assistant** is the central brain.
- Tool calls are surfaced via `thread.run.requires_action` events.
- A custom engine maps tool names → local handler functions, executes them, and feeds the results back to OpenAI so the Run can continue. [cite:9][cite:10]

### 1.4 Multi-step system behavior (phases)

Viewed as phases, Senseii’s backend does roughly this: [cite:19]

1. **User provisioning**
   - Clerk webhook fires on `user.created`.
   - Backend creates a `UserProfile` record with `userId`, email, name, timestamps. [cite:17][cite:16]

2. **Goal creation**
   - `POST /user/goals/new` with goal metadata.
   - Backend validates DTO, creates an **OpenAI Thread**, a **Chat** document, and a **Goal** document linked together.
   - The `chatId` is returned as the handle for future conversation. [cite:19][cite:16]

3. **Conversation & onboarding**
   - `POST /chat` with `{ chatId, content }`.
   - Controller opens an SSE stream, identifies the user, validates input.
   - Service loads the `Chat` by `(userId, chatId)`, gets its `threadId`, appends the user message to the thread, then starts a **streaming Run** with the Core Assistant. [cite:14][cite:9]

4. **Recursive tool-driven reasoning**
   - A `processStream` loop consumes the AssistantStream:
     - Emits token deltas as SSE messages.
     - On `run.requires_action`, looks at required tool calls.
     - Executes matching local tool handlers, which:
       - Parse/validate arguments.
       - Read/write Mongo (`Goals`, `UserProfile`, `NutritionPlan`).
       - Possibly call other models (e.g., nutrition planner, metrics calculator).
     - Submits tool outputs back to the run and starts a new stream (recursion).
   - Stops when `run.completed` is seen. [cite:9]

5. **Metrics & education**
   - Health metrics are computed by a `HealthCalculator` service:
     - BMI, BMR via Mifflin–St Jeor.
     - TDEE via activity multipliers.
     - Macronutrient targets from TDEE and goal type.
   - This is invoked via the `calculate_metrics` tool, and the result is a JSON payload that the Core assistant then **explains to the user**. [cite:15]

6. **Plan generation & persistence**
   - Once enough information and metrics exist, the Core assistant decides to call `create_nutrition_plan`.
   - The handler runs a separate LLM call (nutrition assistant) to create a 7-day plan as structured JSON.
   - Another tool (e.g., `save_approved_nutrition_plan`) writes this plan to the `NutritionPlan` collection and links it to the user’s `Goal`. [cite:12][cite:16]

7. **Ongoing tracking (future/partial)**
   - The intent is to track adherence, progress, and maybe adjust plans.
   - The data model (Goals, Chats, NutritionPlans) supports this, but the orchestration is not fully fleshed out yet. [cite:19]

### 1.5 Infrastructure & state model (today)

- **Infra**
  - Single Node/Express service.
  - MongoDB for persistence.
  - Azure OpenAI for models and Assistants.
  - Clerk for identity + webhooks.

- **State**
  - Short-term conversational state **lives in OpenAI Threads**.
  - Long-term domain state **lives in Mongo**.
  - A custom `AsyncLocalStorage`-driven context gives tools access to `userId` without threading it manually through every call. [cite:19]

The orchestrator code you wrote is effectively a **hand-built agent runtime** on top of OpenAI’s Assistants API. [cite:21]

---

## 2. If Senseii Were Built with LangChain / LangGraph

Now we reimagine the same product on the LangChain + LangGraph stack, keeping the user experience and domain logic but changing **where orchestration, tools, and state live**. [cite:32][cite:33]

Key idea:
- **LangChain** gives you structured *models, tools, and chains*.
- **LangGraph** gives you a first-class, stateful *workflow / agent orchestration runtime* (graphs, nodes, edges, state, persistence, streaming). [cite:33]

### 2.1 New top-level blocks

Here is how the blocks from Section 1.2 would conceptually map:

| Today | With LangChain / LangGraph |
| --- | --- |
| A. API & Auth (Express + Clerk) | **Same**: Express + Clerk, but endpoints call into LangGraph instead of raw `openAIService`. |
| B. Conversation Engine (custom SSE + AssistantStream) | **Replaced by a LangGraph conversation graph** that exposes `invoke/stream` methods to the API layer. |
| C. Agent Orchestrator (Core assistant + manual tool recursion) | **Replaced by a LangGraph StateGraph** with agent nodes and explicit edges; tools registered as LangChain tools. |
| D. Domain Services (nutrition planner, metrics, goals) | **Wrapped as tools and nodes** in LangChain/LangGraph (e.g., metrics node, nutrition-planner node). |
| E. Persistence (Mongo) | **Kept**, but used as the long-term store; LangGraph manages workflow state and checkpoints. |
| F. Provisioning (Clerk webhook) | **Same**, but graph entrypoints assume a valid `user_id` and hydrate state from Mongo. |

So we keep the outer shell (HTTP, auth, DB, formulas) and **delegate orchestration + tool plumbing** to LangGraph/LangChain.

### 2.2 Agent layer in LangGraph terms

Instead of expressing agents implicitly via one OpenAI Assistant plus tools, we make them **explicit LangGraph nodes backed by LangChain agents/models**. [cite:33]

Proposed agents/nodes:
- **Core Agent Node** (Sensei persona)
  - A LangGraph node that takes the current state + latest message and outputs:
    - A response message.
    - Updated control signals (e.g., `needs_metrics = true`, `ready_for_nutrition_plan = true`).
  - It uses a LangChain tool-enabled chat model under the hood.

- **Nutrition Agent Node**
  - LangGraph node responsible for generating or revising nutrition plans.
  - Wraps a LangChain chain with:
    - Input: validated user preferences, metrics, constraints from state.
    - Output: structured meal plan object compatible with your `NutritionPlan` schema.

- **Fitness Agent Node**
  - Similar to Nutrition Agent, but for workout plans.
  - Can use a different model or prompt, but same graph integration.

- **Summary Agent Node**
  - Given a conversation trace and context (goal, plan), outputs a short title.
  - Can run on-demand or at specific graph transitions.

These agents are wired together by **LangGraph’s StateGraph**, not by recursive stream listeners.

### 2.3 Orchestration style with LangGraph

LangGraph gives you a **stateful graph**:
- **Nodes**: functions that read and write a structured state object.
- **Edges**: rules for what node runs next.
- **State**: a schema that defines what’s carried across nodes (messages, profile, metrics, flags, etc.). [cite:33]

For Senseii, a plausible **state schema** (conceptually) would include:
- Identity: `user_id`, `goal_id`, `chat_id`.
- Conversational: `messages` (chat history or references to messages in DB).
- Profile: `basic_information`, `lifestyle`, `diet_preferences`, `eating_habits`, `constraints`, `health_goals`.
- Derived: `metrics` (BMI, BMR, TDEE, macros), `nutrition_plan`, `workout_plan`.
- Control: flags like `needs_more_info`, `needs_metrics`, `needs_nutrition_plan`, `plan_approved`, `phase` (onboarding, planning, tracking).

**Graph flow (conceptual):**
1. **Entry Node (On message)**
   - Input: `(user_id, chat_id, user_message)`.
   - Loads or resumes the LangGraph state for that user/goal.
   - Appends the new message to `state.messages`.
   - Routes to Core Agent Node.

2. **Core Agent Node**
   - Runs the Sensei persona model.
   - Can:
     - Ask follow-up questions (update `messages`).
     - Set flags: `needs_metrics`, `needs_nutrition_plan`, etc.
     - Call **LangChain tools** (update_basic_information, update_lifestyle, …) that:
       - Update state fields.
       - Optionally write-through to Mongo if needed.
   - After running, edges look at flags to decide the next node.

3. **Metrics Node**
   - When `needs_metrics = true`, the graph transitions to a Metrics node.
   - Wraps your existing `HealthCalculator` as a pure function/tool.
   - Writes metrics into `state.metrics` and clears flag.
   - Edge returns to Core Agent Node with enriched state.

4. **Nutrition Planner Node**
   - Triggered when `needs_nutrition_plan = true` and prerequisites (metrics, profile) are present.
   - Calls an LLM with structured output, producing a `nutrition_plan` object.
   - Writes it to `state.nutrition_plan`.
   - Optional separate node persists to Mongo when the plan is **approved** by the user.

5. **Summary Node**
   - Runs either:
     - After new goal created.
     - After plan approved.
   - Produces a short label stored in DB, or in state for UI display.

6. **Sync-to-DB Node**
   - A node responsible for propagating canonical pieces of `state` back into Mongo (Goals, Chats, NutritionPlan).
   - This makes DB writes explicit steps in the graph, not incidental side effects sprinkled across tools.

7. **End / Loop**
   - The graph can return to Core Agent Node for more conversation, or end the current run.
   - Because LangGraph supports **durable execution and checkpoints**, the whole state can be reloaded on a later message. [cite:33]

Notice what disappeared:
- No explicit `AssistantStream` handling.
- No `requires_action` event parsing.
- No manual recursion and stream restarts.

Those behaviors are replaced by: **graph nodes, edges, and state updates**.

### 2.4 Tools and domain logic with LangChain

Instead of `supportedFunctions: Record<string, IFunctionType>`, you would have a **tool library** registered with the Core Agent node (and possibly other agents). [cite:33]

Conceptually, tools map like this:

| Today: Assistant tools | With LangChain tools |
| --- | --- |
| `update_user_basic_information` updates Goal.basicInformation in Mongo. | Tool: `update_basic_information_tool` that takes structured args, updates Mongo and/or graph state. |
| `update_lifestyle`, `update_diet_preferences`, `update_eating_habits`, `update_constraints`, `update_health_goals`. | Similar tools, each focused on a specific slice of the state and DB. |
| `calculate_metrics` calls HealthCalculator and returns JSON. | Tool: pure function over state that writes metrics into state and optionally DB. |
| `create_initial_goal` and goal lifecycle. | Tools and/or dedicated graph nodes that encapsulate goal creation update flows. |
| `create_nutrition_plan` + `save_approved_nutrition_plan`. | A LangChain chain for generation + a persistence tool that writes to `NutritionPlan` collection and updates the goal. |

The **Core Agent node** uses these tools inside an agent loop provided by LangChain, but the orchestration of *when* to go from Core → Metrics → Planner → Summary is encoded in the **LangGraph edges and state flags**, not in raw tool-call recursion.

### 2.5 State & persistence in a LangGraph world

Today, OpenAI Threads are the first-class owner of conversational state. With LangGraph:

- **Graph state** becomes the primary working memory.
- **Mongo** remains the long-term system of record.
- **LangGraph persistence** (checkpoints) can be used to:
  - Resume conversations/workflows from where they left off.
  - Time-travel or inspect intermediate states for debugging. [cite:33]

Practically:
- On each new message, the API passes `(user_id, goal_id, chat_id, message)` to the graph.
- LangGraph loads the last checkpoint of the graph state for that key, runs nodes as needed, and emits messages + state updates.
- A Sync node writes relevant changes to Mongo, and a checkpoint is saved.

You are no longer bound to OpenAI’s thread/run semantics and can switch underlying model providers (still using LangChain integrations for OpenAI/Azure, etc.). [cite:33]

### 2.6 Infrastructure and deployment with LangGraph

LangGraph also brings some **infra opinions**: [cite:32][cite:33]

- A typical app has:
  - A graph definition (`agent.ts` / `agent.py`).
  - Utilities for tools, nodes, and state definitions.
  - A `langgraph.json` configuration for dependencies, graphs, and env vars.
- LangSmith/Agent Server can host the graph as a managed, scalable service.

For Senseii, you’d have two main options:
- **Embed LangGraph inside your existing Node/Express service** and keep everything in one process.
- Or **split**:
  - Express service remains the HTTP/auth/billing/user domain layer.
  - LangGraph app (Python or JS) runs as a separate "agent service" behind an internal API, focusing purely on agent orchestration.

Either way, the overall shape is:
- Frontend → Express API → LangGraph Conversation Graph → MongoDB.

### 2.7 Phase-by-phase comparison

Here is the same lifecycle from §1.4, rephrased with LangGraph:

| Phase | Today | With LangGraph |
| --- | --- | --- |
| Provisioning | Clerk webhook → direct UserProfile write. | Same, no need for LangGraph here. |
| Goal creation | `POST /user/goals/new` → DTO validation → create Chat + Goal + Thread. | Could be handled by a **Goal Management Graph** or a simple endpoint that initializes graph state & DB records together. |
| Conversation | `/chat` → SSE → `openAIService.StreamComplete` → OpenAI thread/run. | `/chat` → SSE → `graph.stream()` on a Conversation Graph keyed by (user_id, goal_id). |
| Info gathering | Core Assistant decides what to ask; tools update DB directly. | Core Agent node decides what to ask; tools update **graph state** first, then a Sync node persists to DB. |
| Metrics | `calculate_metrics` tool calls HealthCalculator and returns JSON. | Metrics node/tool reads profile from state, writes metrics back to state, then optionally to DB. |
| Plan generation | Nutrition tool calls LLM with Zod schema and writes plan to DB. | Nutrition Agent node (LangChain chain) produces structured plan, writes to state, then a persistence node writes to DB when approved. |
| Summary | Summary Assistant runs on thread, then deletes its messages. | Summary node runs on conversation state and stores summary in DB (no need to alter provider-side thread). |
| Tracking | Partially implemented in ad-hoc ways. | Could be a dedicated **Tracking Graph** that reads adherence events, updates progress state, and occasionally routes back through Core/Nutrition/Fitness nodes. |

---

## 3. Net Effect of a LangChain / LangGraph Migration

At a conceptual level, migrating Senseii to LangChain/LangGraph:

- **Keeps**
  - Your domain model (users, goals, plans, metrics).
  - Your formulas and health logic.
  - Your sense of a Core Sensei agent coordinating specialist agents.
  - Your existing HTTP/auth/billing surface.

- **Moves**
  - Orchestration from bespoke `processStream` recursion into a **graph state machine** with explicit nodes and edges.
  - Tool registration from a hand-rolled `supportedFunctions` map into a **LangChain toolset** wired to agents.
  - Working memory from OpenAI threads to **LangGraph state + checkpoints**, giving you provider flexibility and better introspection.

- **Adds**
  - First-class support for **durable execution, streaming, human-in-the-loop, and observability** through LangGraph + LangSmith.
  - A clearer separation between **domain logic** (health/fitness knowledge) and **agent orchestration** (graphs, tools, state transitions).

The user experience can stay exactly the same: "talk to a Japanese Sensei who coordinates specialists on your behalf." The main difference is that instead of you being the runtime for that agent system, **LangGraph becomes the runtime, and LangChain becomes the home for your models and tools.** [cite:33]
