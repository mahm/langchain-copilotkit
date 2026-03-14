import { describe, expect, it } from "bun:test";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { LangChainAgentAdapter } from "./adapter";

function makeMockAgent(events: Array<Record<string, unknown>>) {
	return {
		streamEvents: async function* (_input: unknown, _options: unknown) {
			for (const event of events) {
				yield event;
			}
		},
	} as never;
}

function collectEvents(agent: LangChainAgentAdapter, input: RunAgentInput) {
	return new Promise<BaseEvent[]>((resolve, reject) => {
		const collected: BaseEvent[] = [];
		agent.run(input).subscribe({
			next(event) {
				collected.push(event);
			},
			error: reject,
			complete() {
				resolve(collected);
			},
		});
	});
}

const baseInput: RunAgentInput = {
	threadId: "t1",
	runId: "r1",
	messages: [],
	tools: [],
	context: [],
	state: {},
	forwardedProps: {},
};

describe("LangChainAgentAdapter", () => {
	it("emits RUN_STARTED and RUN_FINISHED for an empty stream", async () => {
		const agent = new LangChainAgentAdapter({ agent: makeMockAgent([]) });
		const events = await collectEvents(agent, baseInput);

		expect(events.length).toBeGreaterThanOrEqual(2);
		expect(events[0].type).toBe(EventType.RUN_STARTED);
		expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
	});

	it("maps text streaming events end-to-end", async () => {
		const agent = new LangChainAgentAdapter({
			agent: makeMockAgent([
				{
					event: "on_chain_start",
					name: "agent",
					data: {},
					run_id: "r1",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chat_model_stream",
					name: "ChatAnthropic",
					data: { chunk: { content: "Hello" } },
					run_id: "r2",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chat_model_stream",
					name: "ChatAnthropic",
					data: { chunk: { content: " world" } },
					run_id: "r2",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chat_model_end",
					name: "ChatAnthropic",
					data: {},
					run_id: "r2",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chain_end",
					name: "agent",
					data: { output: {} },
					run_id: "r1",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
			]),
		});

		const events = await collectEvents(agent, baseInput);
		const types = events.map((e) => e.type);

		expect(types).toEqual([
			EventType.RUN_STARTED,
			EventType.STEP_STARTED,
			EventType.TEXT_MESSAGE_START,
			EventType.TEXT_MESSAGE_CONTENT,
			EventType.TEXT_MESSAGE_CONTENT,
			EventType.TEXT_MESSAGE_END,
			EventType.STEP_FINISHED,
			EventType.RUN_FINISHED,
		]);

		const deltas = events
			.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT)
			.map((e) => (e as unknown as { delta: string }).delta);
		expect(deltas).toEqual(["Hello", " world"]);
	});

	it("maps tool call events end-to-end", async () => {
		const agent = new LangChainAgentAdapter({
			agent: makeMockAgent([
				{
					event: "on_chain_start",
					name: "agent",
					data: {},
					run_id: "r1",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chat_model_stream",
					name: "ChatAnthropic",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [
								{ name: "search", args: '{"q":"test"}', id: "tc_1", index: 0 },
							],
						},
					},
					run_id: "r2",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chat_model_end",
					name: "ChatAnthropic",
					data: {},
					run_id: "r2",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chain_end",
					name: "agent",
					data: { output: {} },
					run_id: "r1",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chain_start",
					name: "tools",
					data: {},
					run_id: "r3",
					tags: [],
					metadata: { langgraph_node: "tools" },
				},
				{
					event: "on_tool_end",
					name: "search",
					data: {
						output: {
							content: "result",
							tool_call_id: "tc_1",
							id: "msg_tool",
						},
					},
					run_id: "r4",
					tags: [],
					metadata: { langgraph_node: "tools" },
				},
				{
					event: "on_chain_end",
					name: "tools",
					data: { output: {} },
					run_id: "r3",
					tags: [],
					metadata: { langgraph_node: "tools" },
				},
			]),
		});

		const events = await collectEvents(agent, baseInput);
		const types = events.map((e) => e.type);

		expect(types).toEqual([
			EventType.RUN_STARTED,
			EventType.STEP_STARTED, // agent
			EventType.TEXT_MESSAGE_START, // synthetic parent for tool call
			EventType.TEXT_MESSAGE_END,
			EventType.TOOL_CALL_START,
			EventType.TOOL_CALL_ARGS,
			EventType.TOOL_CALL_END,
			EventType.STEP_FINISHED, // agent
			EventType.STEP_STARTED, // tools
			EventType.TOOL_CALL_RESULT,
			EventType.STEP_FINISHED, // tools
			EventType.RUN_FINISHED,
		]);
	});

	it("emits RUN_ERROR on stream failure", async () => {
		const failingAgent = {
			streamEvents: () => ({
				[Symbol.asyncIterator]: () => ({
					next: () => Promise.reject(new Error("boom")),
				}),
			}),
		} as never;

		const agent = new LangChainAgentAdapter({ agent: failingAgent });
		const events = await collectEvents(agent, baseInput);

		expect(events[0].type).toBe(EventType.RUN_STARTED);
		expect(events.at(-1)?.type).toBe(EventType.RUN_ERROR);
		expect((events.at(-1) as unknown as { message: string }).message).toBe(
			"boom",
		);
	});

	it("clone() preserves langGraphAgent and runs correctly", async () => {
		const original = new LangChainAgentAdapter({
			agent: makeMockAgent([
				{
					event: "on_chain_start",
					name: "agent",
					data: {},
					run_id: "r1",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chat_model_stream",
					name: "ChatAnthropic",
					data: { chunk: { content: "cloned!" } },
					run_id: "r2",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chat_model_end",
					name: "ChatAnthropic",
					data: {},
					run_id: "r2",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chain_end",
					name: "agent",
					data: { output: {} },
					run_id: "r1",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
			]),
			stateKeys: ["messages"],
		});

		const cloned = original.clone();
		const events = await collectEvents(cloned, baseInput);
		const types = events.map((e) => e.type);

		expect(types).toContain(EventType.RUN_STARTED);
		expect(types).toContain(EventType.TEXT_MESSAGE_CONTENT);
		expect(types).toContain(EventType.RUN_FINISHED);
	});

	it("maps array content blocks (Anthropic) end-to-end", async () => {
		const agent = new LangChainAgentAdapter({
			agent: makeMockAgent([
				{
					event: "on_chain_start",
					name: "agent",
					data: {},
					run_id: "r1",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chat_model_stream",
					name: "ChatAnthropic",
					data: {
						chunk: {
							content: [{ type: "text", text: "Hello" }],
						},
					},
					run_id: "r2",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chat_model_stream",
					name: "ChatAnthropic",
					data: {
						chunk: {
							content: [{ type: "text", text: " world" }],
						},
					},
					run_id: "r2",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chat_model_end",
					name: "ChatAnthropic",
					data: {},
					run_id: "r2",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chain_end",
					name: "agent",
					data: { output: {} },
					run_id: "r1",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
			]),
		});

		const events = await collectEvents(agent, baseInput);
		const deltas = events
			.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT)
			.map((e) => (e as unknown as { delta: string }).delta);
		expect(deltas).toEqual(["Hello", " world"]);
	});

	it("maps multi-chunk tool call with consistent toolCallId", async () => {
		const agent = new LangChainAgentAdapter({
			agent: makeMockAgent([
				{
					event: "on_chain_start",
					name: "agent",
					data: {},
					run_id: "r1",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chat_model_stream",
					name: "ChatAnthropic",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [
								{ name: "search", args: '{"q":', id: "tc_1", index: 0 },
							],
						},
					},
					run_id: "r2",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chat_model_stream",
					name: "ChatAnthropic",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [{ args: '"test"}', id: null, index: 0 }],
						},
					},
					run_id: "r2",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chat_model_end",
					name: "ChatAnthropic",
					data: {},
					run_id: "r2",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
				{
					event: "on_chain_end",
					name: "agent",
					data: { output: {} },
					run_id: "r1",
					tags: [],
					metadata: { langgraph_node: "agent" },
				},
			]),
		});

		const events = await collectEvents(agent, baseInput);
		const toolCallEvents = events.filter(
			(e) =>
				e.type === EventType.TOOL_CALL_START ||
				e.type === EventType.TOOL_CALL_ARGS ||
				e.type === EventType.TOOL_CALL_END,
		);

		// All tool call events should reference the same toolCallId
		const ids = toolCallEvents.map(
			(e) => (e as unknown as { toolCallId: string }).toolCallId,
		);
		expect(ids.every((id) => id === "tc_1")).toBe(true);
	});

	it("passes multi-turn messages to streamEvents", async () => {
		let capturedInput: Record<string, unknown> | null = null;
		const capturingAgent = {
			streamEvents: (input: Record<string, unknown>, _opts: unknown) => {
				capturedInput = input;
				return {
					async *[Symbol.asyncIterator]() {
						// empty stream
					},
				};
			},
		} as never;

		const agent = new LangChainAgentAdapter({ agent: capturingAgent });
		await collectEvents(agent, {
			...baseInput,
			messages: [
				{ id: "1", role: "user", content: "hello" },
				{ id: "2", role: "assistant", content: "hi there" },
				{ id: "3", role: "user", content: "how are you?" },
				{ id: "4", role: "assistant", content: "I'm good!" },
				{ id: "5", role: "user", content: "great" },
			],
		});

		expect(capturedInput).not.toBeNull();
		const messages = (capturedInput as unknown as { messages: unknown[] })
			.messages;
		expect(messages).toHaveLength(5);
	});

	it("converts input messages before streaming", async () => {
		let capturedInput: Record<string, unknown> | null = null;
		const capturingAgent = {
			streamEvents: (input: Record<string, unknown>, _opts: unknown) => {
				capturedInput = input;
				return {
					async *[Symbol.asyncIterator]() {
						// empty stream
					},
				};
			},
		} as never;

		const agent = new LangChainAgentAdapter({ agent: capturingAgent });
		await collectEvents(agent, {
			...baseInput,
			messages: [{ id: "1", role: "user", content: "hello" }],
		});

		expect(capturedInput).not.toBeNull();
		const messages = (capturedInput as unknown as { messages: unknown[] })
			.messages;
		expect(messages).toHaveLength(1);
		expect((messages[0] as { _getType: () => string })._getType()).toBe(
			"human",
		);
	});
});
