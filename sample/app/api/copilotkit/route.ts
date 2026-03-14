import {
	CopilotRuntime,
	copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { createDeepAgent, StateBackend } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";
import { LangChainAgentAdapter } from "langchain-copilotkit";

const agent = createDeepAgent({
	model: "claude-sonnet-4-6",
	backend: (config) => new StateBackend(config),
	checkpointer: new MemorySaver(),
});

const runtime = new CopilotRuntime({
	agents: {
		default: new LangChainAgentAdapter({ agent }),
	},
});

export const { handleRequest: POST } = copilotRuntimeNextJSAppRouterEndpoint({
	runtime,
	endpoint: "/api/copilotkit",
});
