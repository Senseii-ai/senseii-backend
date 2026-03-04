# Senseii Backend Architecture Analysis — Perplexity AI

## Overview
Senseii is a multi-agent AI health and lifestyle system designed as a "Jarvis for health." It is built using **Node.js, Express, MongoDB, and the OpenAI Assistants API (Azure OpenAI)**. Authentication is managed via **Clerk** with webhook-based user provisioning. The system uses a shared `@senseii/types` package for Zod-based validation across the stack.

## Core Agent Architecture
The system operates with three specialized assistants, primarily coordinated through the OpenAI Assistants framework:

1.  **Core Assistant (The Orchestrator)**: Uses a "Japanese Sensei" persona (wise, concise, authoritative). It is the sole interface for the user, responsible for gathering information, defining goals, and triggering domain-specific logic via function calling.
2.  **Nutrition Assistant**: Specialized in generating structured 7-day meal plans. Unlike the Core Assistant, it uses `chat.completions.parse()` with `zodResponseFormat` to ensure the output maps directly to the MongoDB `NutritionPlan` schema.
3.  **Summary Assistant**: A utility agent that summarizes chat threads into 2-3 word titles by performing a non-streaming run and then cleaning up the thread.
4.  **Fitness Assistant**: Currently a placeholder/WIP with defined constants but no implementation in `fitness.assistant.ts`.

## Orchestration & Tooling
The heart of Senseii is a custom **recursive stream processing** loop (`processStream()`) that handles the OpenAI Assistants API's event-driven nature:

-   **Streaming & SSE**: User messages are added to an OpenAI Thread. A streaming Run is created, and events (deltas, tool calls, completion) are processed. Updates are sent to the frontend in real-time using **Server-Sent Events (SSE)**.
-   **Function Tooling**: The Core Assistant has **10 registered tools** (e.g., `update_lifestyle`, `calculate_metrics`, `create_nutrition_plan`). 
-   **Tool Registry**: A manual `supportedFunctions` record maps tool names to their handler functions, providing a dispatch mechanism for the `requires_action` state.
-   **Argument Validation**: Uses a `getValidArguments` helper which performs an additional LLM call to ensure function arguments strictly adhere to Zod schemas before execution.

## Key Design Patterns
-   **State Management**: Conversation history is managed by OpenAI Threads (external state), while user profile data, goals, and parallel message copies are persisted in **MongoDB** (internal state).
-   **Deterministic Logic**: Scientific calculations for BMI, BMR, TDEE, and Macros are handled by a dedicated `HealthCalculator` service using established equations (e.g., Mifflin-St Jeor), rather than relying on LLM estimation.
-   **Inter-Agent Communication**: Orchestration is achieved via "tool calls." When the Core Assistant decides a nutrition plan is needed, it triggers a function that internally executes the Nutrition Assistant's logic.

## Current Tech Stack (In-House Components)
-   **Recursive Event Loop**: Custom implementation for handling multi-step tool call chains.
-   **SSE Transport Layer**: Custom `StreamHandler` for real-time frontend updates.
-   **Scientific Engine**: Deterministic health metrics calculator.
-   **Function Dispatcher**: Manual registry for mapping and executing local tools.
-   **State Sync**: Logic to keep local MongoDB records in sync with OpenAI thread activities.

---
*Analysis performed by Perplexity (Gemini 3.0 Flash Thinking) on February 19, 2026.*
