# langchain-copilotkit Sample App

A sample chat UI application integrating LangChain (LangGraph) with CopilotKit. Uses the `langchain-copilotkit` adapter to connect a LangGraph agent to the CopilotKit runtime.

## Stack

- **Next.js 16** + React 19 + Tailwind CSS 4
- **CopilotKit** — chat UI and runtime
- **LangGraph** — agent orchestration
- **deepagents** — LangGraph agent builder

## Setup

### Prerequisites

- [bun](https://bun.sh/) installed
- Anthropic API key or OpenAI API key

### Steps

1. Install dependencies from the repository root (monorepo):

```bash
bun install
```

2. Set up environment variables:

```bash
cp .env.sample .env.local
```

Edit `.env.local` and add your LLM provider API key:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

## Running

```bash
bun dev
```

Open http://localhost:3000 in your browser to see the chat UI.
