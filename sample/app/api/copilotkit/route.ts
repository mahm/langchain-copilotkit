import {
	CopilotRuntime,
	copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { createDeepAgent, StateBackend } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { LangChainAgentAdapter } from "langchain-copilotkit";

const sendEmail = tool(
	async ({ to, subject, body }) => {
		return `Email sent to ${to} with subject "${subject}"`;
	},
	{
		name: "send_email",
		description: "Send an email to a recipient",
		schema: z.object({
			to: z.string().describe("Recipient email address"),
			subject: z.string().describe("Email subject"),
			body: z.string().describe("Email body content"),
		}),
	},
);

const agent = createDeepAgent({
	model: "claude-sonnet-4-6",
	backend: (config) => new StateBackend(config),
	checkpointer: new MemorySaver(),
	tools: [sendEmail],
	interruptOn: {
		send_email: { allowedDecisions: ["approve", "reject"] },
	},
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
