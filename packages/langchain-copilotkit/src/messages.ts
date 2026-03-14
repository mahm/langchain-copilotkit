import type { Message, ToolCall } from "@ag-ui/client";
import {
	AIMessage,
	type BaseMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
} from "@langchain/core/messages";

/**
 * Convert AG-UI Messages to LangChain BaseMessages.
 */
export function convertMessages(messages: Message[]): BaseMessage[] {
	return messages.map(convertMessage).filter(Boolean) as BaseMessage[];
}

function convertMessage(message: Message): BaseMessage | null {
	switch (message.role) {
		case "user":
			return new HumanMessage({
				content:
					typeof message.content === "string"
						? message.content
						: JSON.stringify(message.content),
				id: message.id,
			});

		case "assistant": {
			const msg = message as { toolCalls?: ToolCall[] } & Message;
			const toolCalls = msg.toolCalls?.map((tc: ToolCall) => ({
				name: tc.function.name,
				args: safeParseJson(tc.function.arguments),
				id: tc.id,
				type: "tool_call" as const,
			}));
			return new AIMessage({
				content: (message as { content?: string }).content ?? "",
				id: message.id,
				tool_calls: toolCalls,
			});
		}

		case "system":
		case "developer":
			return new SystemMessage({
				content: (message as { content: string }).content,
				id: message.id,
			});

		case "tool": {
			const toolMsg = message as {
				content: string;
				toolCallId: string;
			} & Message;
			return new ToolMessage({
				content: toolMsg.content,
				tool_call_id: toolMsg.toolCallId,
				id: message.id,
			});
		}

		case "activity":
		case "reasoning":
			return null;

		default: {
			const m = message as Message;
			return new HumanMessage({
				content: JSON.stringify(m),
				id: m.id,
			});
		}
	}
}

/**
 * Convert LangChain BaseMessages to AG-UI Messages.
 */
export function convertToAgUiMessages(messages: BaseMessage[]): Message[] {
	return messages.map(convertToAgUiMessage);
}

function convertToAgUiMessage(message: BaseMessage): Message {
	const id = message.id ?? crypto.randomUUID();
	const contentStr =
		typeof message.content === "string"
			? message.content
			: JSON.stringify(message.content);

	switch (message._getType()) {
		case "human":
			return { id, role: "user" as const, content: contentStr };

		case "ai": {
			const aiMsg = message as AIMessage;
			const toolCalls = aiMsg.tool_calls?.map((tc) => ({
				id: tc.id ?? crypto.randomUUID(),
				type: "function" as const,
				function: {
					name: tc.name,
					arguments: JSON.stringify(tc.args),
				},
			}));
			return {
				id,
				role: "assistant" as const,
				content: contentStr,
				toolCalls: toolCalls?.length ? toolCalls : undefined,
			};
		}

		case "system":
			return { id, role: "system" as const, content: contentStr };

		case "tool": {
			const toolMsg = message as ToolMessage;
			return {
				id,
				role: "tool" as const,
				content: contentStr,
				toolCallId: toolMsg.tool_call_id,
			};
		}

		default:
			return { id, role: "user" as const, content: contentStr };
	}
}

function safeParseJson(str: string): Record<string, unknown> {
	try {
		return JSON.parse(str);
	} catch {
		return { raw: str };
	}
}
