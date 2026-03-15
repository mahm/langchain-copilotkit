import {
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { tool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";
import { createDeepAgent, StateBackend } from "deepagents";
import { LangChainAgentAdapter } from "langchain-copilotkit";
import { z } from "zod";

const sendEmail = tool(
  async ({ to, subject }) => {
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
