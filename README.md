# langgraph-agui

LangGraph.js AG-UI Protocol Adapter — connect LangGraph agents to [CopilotKit](https://copilotkit.ai) and other [AG-UI](https://github.com/ag-ui-protocol/ag-ui) consumers **without running a separate server**.

## Features

- **In-process integration** — no `langgraph dev` server required
- **CopilotKit-ready** — `LangGraphAgent` extends `AbstractAgent` from `@ag-ui/client`
- **Standalone HTTP** — `createAgUiHandler()` produces a Web-standard `Request → Response` handler
- **Full event mapping** — text streaming, tool calls, state snapshots, step tracking

## Installation

```bash
npm install langgraph-agui @langchain/core @langchain/langgraph
# or
bun add langgraph-agui @langchain/core @langchain/langgraph
```

## Usage

### CopilotKit Direct Integration (recommended)

Use `LangGraphAgent` directly with CopilotKit's runtime — no HTTP hop:

```typescript
import { CopilotRuntime } from "@copilotkit/runtime";
import { createDeepAgent } from "deepagents";
import { LangGraphAgent } from "langgraph-agui";

const agent = createDeepAgent({ model: "claude-sonnet-4-6" });

const runtime = new CopilotRuntime({
  agents: [new LangGraphAgent({ agent })],
});
```

### Next.js App Router

```typescript
// app/api/copilotkit/route.ts
import { CopilotRuntime } from "@copilotkit/runtime";
import { copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { createDeepAgent } from "deepagents";
import { LangGraphAgent } from "langgraph-agui";

const agent = createDeepAgent({ model: "claude-sonnet-4-6" });
const runtime = new CopilotRuntime({
  agents: [new LangGraphAgent({ agent })],
});

export const { handleRequest: POST } = copilotRuntimeNextJSAppRouterEndpoint({
  runtime,
  endpoint: "/api/copilotkit",
});
```

### Standalone HTTP (Bun.serve)

```typescript
import { createDeepAgent } from "deepagents";
import { createAgUiHandler } from "langgraph-agui";

const agent = createDeepAgent({ model: "claude-sonnet-4-6" });
const handler = createAgUiHandler({ agent });

Bun.serve({ port: 3000, fetch: handler });
```

### Standalone HTTP (Express)

```typescript
import express from "express";
import { createDeepAgent } from "deepagents";
import { createAgUiHandler } from "langgraph-agui";

const agent = createDeepAgent({ model: "claude-sonnet-4-6" });
const handler = createAgUiHandler({ agent });

const app = express();

app.post("/ag-ui", async (req, res) => {
  // Convert Express request to Web Request
  const webReq = new Request(`http://localhost${req.url}`, {
    method: "POST",
    headers: req.headers as Record<string, string>,
    body: JSON.stringify(req.body),
  });
  const response = await handler(webReq);
  res.status(response.status);
  response.headers.forEach((v, k) => res.setHeader(k, v));
  const body = await response.text();
  res.send(body);
});

app.listen(3000);
```

## API Reference

### `LangGraphAgent`

Extends `AbstractAgent` from `@ag-ui/client`. Use this when integrating directly with CopilotKit or any AG-UI consumer.

```typescript
new LangGraphAgent(options: LangGraphAgentOptions & Partial<AgentConfig>)
```

| Option      | Type       | Description                                      |
|-------------|------------|--------------------------------------------------|
| `agent`     | `Runnable` | A LangGraph compiled graph or any LangChain Runnable |
| `stateKeys` | `string[]` | State keys to include in `STATE_SNAPSHOT` events |

### `createAgUiHandler(options)`

Returns a `(Request) => Promise<Response>` handler that speaks AG-UI over SSE.

### `convertMessages(messages)`

Converts AG-UI `Message[]` to LangChain `BaseMessage[]`.

### `convertToAgUiMessages(messages)`

Converts LangChain `BaseMessage[]` to AG-UI `Message[]`.

### `EventMapper`

Low-level class that maps individual LangGraph `StreamEvent` objects to AG-UI `BaseEvent[]`.

## Event Mapping

| LangGraph Event            | AG-UI Event(s)                                          |
|---------------------------|---------------------------------------------------------|
| `on_chat_model_stream`    | `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`             |
| `on_chat_model_stream` (tool) | `TOOL_CALL_START`, `TOOL_CALL_ARGS`                 |
| `on_chat_model_end`       | `TEXT_MESSAGE_END`, `TOOL_CALL_END`                     |
| `on_tool_end`             | `TOOL_CALL_RESULT`                                      |
| `on_chain_start` (node)   | `STEP_STARTED`                                          |
| `on_chain_end` (node)     | `STATE_SNAPSHOT` (if stateKeys set), `STEP_FINISHED`    |
| *(run lifecycle)*         | `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`              |

## License

MIT
