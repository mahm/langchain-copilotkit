# langchain-copilotkit

LangChain Agent Adapter for CopilotKit — connect LangChain/LangGraph agents to [CopilotKit](https://copilotkit.ai) via the [AG-UI](https://github.com/ag-ui-protocol/ag-ui) protocol **without running a separate server**.

## Features

- **In-process integration** — no `langgraph dev` server required
- **CopilotKit-ready** — `LangChainAgentAdapter` extends `AbstractAgent` from `@ag-ui/client`
- **Full event mapping** — text streaming, tool calls, state snapshots, step tracking
- **HITL support** — interrupt/resume with approve, reject, and natural language feedback

## Installation

```bash
npm install langchain-copilotkit @langchain/core @langchain/langgraph
```

## Quick Start

```typescript
import { CopilotRuntime } from "@copilotkit/runtime";
import { createDeepAgent } from "deepagents";
import { LangChainAgentAdapter } from "langchain-copilotkit";

const agent = createDeepAgent({ model: "claude-sonnet-4-6" });

const runtime = new CopilotRuntime({
  agents: [new LangChainAgentAdapter({ agent })],
});
```

### Next.js App Router

```typescript
// app/api/copilotkit/route.ts
import { CopilotRuntime, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { createDeepAgent } from "deepagents";
import { LangChainAgentAdapter } from "langchain-copilotkit";

const agent = createDeepAgent({ model: "claude-sonnet-4-6" });
const runtime = new CopilotRuntime({
  agents: [new LangChainAgentAdapter({ agent })],
});

export const { handleRequest: POST } = copilotRuntimeNextJSAppRouterEndpoint({
  runtime,
  endpoint: "/api/copilotkit",
});
```

## API

### `LangChainAgentAdapter`

Extends `AbstractAgent` from `@ag-ui/client`.

```typescript
new LangChainAgentAdapter(options)
```

| Option      | Type       | Description                                      |
|-------------|------------|--------------------------------------------------|
| `agent`     | `Runnable` | A LangGraph compiled graph or any LangChain Runnable |
| `stateKeys` | `string[]` | State keys to include in `STATE_SNAPSHOT` events |

### `convertMessages(messages)` / `convertToAgUiMessages(messages)`

Bidirectional conversion between AG-UI `Message[]` and LangChain `BaseMessage[]`.

### `EventMapper`

Low-level class that maps individual LangChain `StreamEvent` objects to AG-UI `BaseEvent[]`.

## Event Mapping

| LangChain Event                | AG-UI Event(s)                                      |
|-------------------------------|-----------------------------------------------------|
| `on_chat_model_stream`        | `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`         |
| `on_chat_model_stream` (tool) | `TOOL_CALL_START`, `TOOL_CALL_ARGS`                 |
| `on_chat_model_end`           | `TEXT_MESSAGE_END`, `TOOL_CALL_END`                 |
| `on_tool_end`                 | `TOOL_CALL_RESULT`                                  |
| `on_chain_start` (node)       | `STEP_STARTED`                                      |
| `on_chain_end` (node)         | `STATE_SNAPSHOT` (if stateKeys set), `STEP_FINISHED` |
| *(run lifecycle)*             | `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`          |

## License

MIT
