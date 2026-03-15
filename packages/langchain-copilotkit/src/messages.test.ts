import { describe, expect, it } from "bun:test";
import {
	AIMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
} from "@langchain/core/messages";
import { convertMessages, convertToAgUiMessages } from "./messages";

describe("convertMessages", () => {
	it("converts user message to HumanMessage", () => {
		const result = convertMessages([
			{ id: "1", role: "user", content: "hello" },
		]);
		expect(result).toHaveLength(1);
		expect(result[0]._getType()).toBe("human");
		expect(result[0].content).toBe("hello");
		expect(result[0].id).toBe("1");
	});

	it("converts assistant message to AIMessage", () => {
		const result = convertMessages([
			{ id: "2", role: "assistant", content: "hi there" },
		]);
		expect(result).toHaveLength(1);
		expect(result[0]._getType()).toBe("ai");
		expect(result[0].content).toBe("hi there");
	});

	it("converts assistant message with tool calls", () => {
		const result = convertMessages([
			{
				id: "3",
				role: "assistant",
				content: "",
				toolCalls: [
					{
						id: "tc_1",
						type: "function" as const,
						function: {
							name: "search",
							arguments: '{"query":"test"}',
						},
					},
				],
			},
		]);
		expect(result).toHaveLength(1);
		const ai = result[0] as AIMessage;
		expect(ai._getType()).toBe("ai");
		expect(ai.tool_calls).toHaveLength(1);
		expect(ai.tool_calls?.[0].name).toBe("search");
		expect(ai.tool_calls?.[0].args).toEqual({ query: "test" });
		expect(ai.tool_calls?.[0].id).toBe("tc_1");
	});

	it("converts system message to SystemMessage", () => {
		const result = convertMessages([
			{ id: "4", role: "system", content: "you are helpful" },
		]);
		expect(result).toHaveLength(1);
		expect(result[0]._getType()).toBe("system");
		expect(result[0].content).toBe("you are helpful");
	});

	it("converts developer message to SystemMessage", () => {
		const result = convertMessages([
			{ id: "5", role: "developer", content: "instructions" },
		]);
		expect(result).toHaveLength(1);
		expect(result[0]._getType()).toBe("system");
	});

	it("converts tool message to ToolMessage", () => {
		const result = convertMessages([
			{
				id: "6",
				role: "tool",
				content: "result",
				toolCallId: "tc_1",
			},
		]);
		expect(result).toHaveLength(1);
		expect(result[0]._getType()).toBe("tool");
		expect((result[0] as ToolMessage).tool_call_id).toBe("tc_1");
	});

	it("skips activity and reasoning messages", () => {
		const result = convertMessages([
			{
				id: "7",
				role: "activity",
				activityType: "typing",
				content: {},
			} as never,
			{ id: "8", role: "reasoning", content: "thinking..." } as never,
		]);
		expect(result).toHaveLength(0);
	});
});

describe("convertToAgUiMessages", () => {
	it("converts HumanMessage to user message", () => {
		const result = convertToAgUiMessages([
			new HumanMessage({ content: "hello", id: "1" }),
		]);
		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("user");
		expect((result[0] as { content: string }).content).toBe("hello");
	});

	it("converts AIMessage to assistant message", () => {
		const result = convertToAgUiMessages([
			new AIMessage({ content: "response", id: "2" }),
		]);
		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("assistant");
	});

	it("converts AIMessage with tool calls", () => {
		const result = convertToAgUiMessages([
			new AIMessage({
				content: "",
				id: "3",
				tool_calls: [{ name: "search", args: { q: "test" }, id: "tc_1" }],
			}),
		]);
		const msg = result[0] as unknown as {
			toolCalls?: { function: { name: string; arguments: string } }[];
		};
		expect(msg.toolCalls).toHaveLength(1);
		expect(msg.toolCalls?.[0].function.name).toBe("search");
		expect(JSON.parse(msg.toolCalls?.[0].function.arguments ?? "")).toEqual({
			q: "test",
		});
	});

	it("converts SystemMessage", () => {
		const result = convertToAgUiMessages([
			new SystemMessage({ content: "sys", id: "4" }),
		]);
		expect(result[0].role).toBe("system");
	});

	it("converts ToolMessage", () => {
		const result = convertToAgUiMessages([
			new ToolMessage({ content: "ok", tool_call_id: "tc_1", id: "5" }),
		]);
		expect(result[0].role).toBe("tool");
		expect((result[0] as { toolCallId: string }).toolCallId).toBe("tc_1");
	});

	it("generates UUID when message has no id", () => {
		const result = convertToAgUiMessages([
			new HumanMessage({ content: "hello" }),
		]);
		expect(result[0].id).toBeDefined();
		expect(typeof result[0].id).toBe("string");
		expect(result[0].id.length).toBeGreaterThan(0);
	});

	it("converts non-string content to JSON string", () => {
		const result = convertToAgUiMessages([
			new HumanMessage({
				content: [{ type: "text", text: "hello" }] as never,
				id: "1",
			}),
		]);
		expect((result[0] as { content: string }).content).toBe(
			JSON.stringify([{ type: "text", text: "hello" }]),
		);
	});

	it("omits toolCalls when tool_calls array is empty", () => {
		const result = convertToAgUiMessages([
			new AIMessage({ content: "hi", id: "1", tool_calls: [] }),
		]);
		const msg = result[0] as unknown as { toolCalls?: unknown[] };
		expect(msg.toolCalls).toBeUndefined();
	});

	it("falls back to user role for unknown message types", () => {
		// Use a generic BaseMessage subclass (FunctionMessage is uncommon)
		const { FunctionMessage } = require("@langchain/core/messages");
		const result = convertToAgUiMessages([
			new FunctionMessage({ content: "fn result", name: "fn", id: "1" }),
		]);
		expect(result[0].role).toBe("user");
	});
});

describe("convertMessages edge cases", () => {
	it("converts non-string content via JSON.stringify", () => {
		const result = convertMessages([
			{
				id: "1",
				role: "user",
				content: { nested: "value" } as unknown as string,
			},
		]);
		expect(result).toHaveLength(1);
		expect(result[0].content).toBe(JSON.stringify({ nested: "value" }));
	});

	it("handles invalid JSON in tool call arguments via safeParseJson", () => {
		const result = convertMessages([
			{
				id: "1",
				role: "assistant",
				content: "",
				toolCalls: [
					{
						id: "tc_1",
						type: "function" as const,
						function: {
							name: "search",
							arguments: "not valid json",
						},
					},
				],
			},
		]);
		const ai = result[0] as AIMessage;
		expect(ai.tool_calls?.[0].args).toEqual({ raw: "not valid json" });
	});

	it("falls back to HumanMessage for unknown role", () => {
		const result = convertMessages([
			{ id: "1", role: "custom_role" as never, content: "hello" },
		]);
		expect(result).toHaveLength(1);
		expect(result[0]._getType()).toBe("human");
	});
});
