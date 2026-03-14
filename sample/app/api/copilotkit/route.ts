import {
	CopilotRuntime,
	copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { createDeepAgent } from "deepagents";
import { LangGraphAgent } from "langgraph-agui";

const deepAgent = createDeepAgent({ model: "claude-sonnet-4-6" });

const runtime = new CopilotRuntime({
	agents: {
		default: new LangGraphAgent({ agent: deepAgent }),
	},
});

export const { handleRequest: POST } = copilotRuntimeNextJSAppRouterEndpoint({
	runtime,
	endpoint: "/api/copilotkit",
});
