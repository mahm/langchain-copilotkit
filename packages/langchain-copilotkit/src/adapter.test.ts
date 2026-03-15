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

	it("passes multi-turn messages to streamEvents (stateful filters to new)", async () => {
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
		// Default stateful: true filters to only new user message after last assistant
		expect(messages).toHaveLength(1);
		expect((messages[0] as { content: string }).content).toBe("great");
	});

	it("emits CUSTOM interrupt event when getState returns interrupts", async () => {
		const mockAgent = {
			streamEvents: async function* (_input: unknown, _options: unknown) {
				// empty stream
			},
			getState: async (_config: unknown) => ({
				tasks: [
					{
						interrupts: [
							{
								value: {
									action: "send_email",
									args: { to: "test@example.com" },
								},
							},
						],
					},
				],
			}),
		} as never;

		const agent = new LangChainAgentAdapter({ agent: mockAgent });
		const events = await collectEvents(agent, baseInput);
		const types = events.map((e) => e.type);

		expect(types).toContain(EventType.CUSTOM);
		const customEvent = events.find(
			(e) => e.type === EventType.CUSTOM,
		) as unknown as { name: string; value: string };
		expect(customEvent.name).toBe("on_interrupt");
		expect(JSON.parse(customEvent.value)).toEqual({
			action: "send_email",
			args: { to: "test@example.com" },
		});
		// CUSTOM should come before RUN_FINISHED
		const customIdx = types.indexOf(EventType.CUSTOM);
		const finishedIdx = types.indexOf(EventType.RUN_FINISHED);
		expect(customIdx).toBeLessThan(finishedIdx);
	});

	it("passes Command as input when forwardedProps.command.resume is present", async () => {
		let capturedInput: unknown = null;
		const capturingAgent = {
			streamEvents: (input: unknown, _opts: unknown) => {
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
			forwardedProps: {
				command: { resume: "user approved" },
			},
		});

		expect(capturedInput).not.toBeNull();
		const cmd = capturedInput as { lg_name?: string; resume?: unknown };
		expect(cmd.lg_name).toBe("Command");
		expect(cmd.resume).toBe("user approved");
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

// Helper to create a capturing agent that records the input passed to streamEvents
function makeCapturingAgent() {
	let capturedInput: Record<string, unknown> | null = null;
	const agent = {
		streamEvents: (input: Record<string, unknown>, _opts: unknown) => {
			capturedInput = input;
			return {
				async *[Symbol.asyncIterator]() {
					// empty stream
				},
			};
		},
	} as never;
	return {
		agent,
		getInput: () => capturedInput,
		getMessages: () =>
			(capturedInput as unknown as { messages: unknown[] })?.messages ?? [],
	};
}

describe("stateful mode", () => {
	it("sends all messages on first turn when no assistant message exists", async () => {
		const capturing = makeCapturingAgent();
		const adapter = new LangChainAgentAdapter({
			agent: capturing.agent,
			stateful: true,
		});
		await collectEvents(adapter, {
			...baseInput,
			messages: [{ id: "1", role: "user", content: "hello" }],
		});

		// First turn (no assistant) should send all messages
		expect(capturing.getMessages()).toHaveLength(1);
		expect(
			(capturing.getMessages()[0] as { _getType: () => string })._getType(),
		).toBe("human");
	});

	it("sends only new user messages on subsequent turns", async () => {
		const capturing = makeCapturingAgent();
		const adapter = new LangChainAgentAdapter({
			agent: capturing.agent,
			stateful: true,
		});
		await collectEvents(adapter, {
			...baseInput,
			messages: [
				{ id: "1", role: "user", content: "create slides" },
				{
					id: "2",
					role: "assistant",
					content: "",
					toolCalls: [
						{
							id: "tc_1",
							type: "function" as const,
							function: { name: "search", arguments: "{}" },
						},
					],
				},
				{ id: "3", role: "tool", content: "result", toolCallId: "tc_1" },
				{ id: "4", role: "assistant", content: "Here is the outline." },
				{ id: "5", role: "user", content: "OK" },
			],
		});

		// Only the new user message should be sent
		const messages = capturing.getMessages();
		expect(messages).toHaveLength(1);
		expect((messages[0] as { _getType: () => string })._getType()).toBe(
			"human",
		);
		expect((messages[0] as { content: string }).content).toBe("OK");
	});

	it("sends only new messages when stateful is not set (default: true)", async () => {
		const capturing = makeCapturingAgent();
		const adapter = new LangChainAgentAdapter({ agent: capturing.agent });
		await collectEvents(adapter, {
			...baseInput,
			messages: [
				{ id: "1", role: "user", content: "hello" },
				{ id: "2", role: "assistant", content: "hi" },
				{ id: "3", role: "user", content: "bye" },
			],
		});

		// Default (stateful: true) should filter to only new user messages
		expect(capturing.getMessages()).toHaveLength(1);
		expect((capturing.getMessages()[0] as { content: string }).content).toBe(
			"bye",
		);
	});

	it("sends all messages when stateful is explicitly false", async () => {
		const capturing = makeCapturingAgent();
		const adapter = new LangChainAgentAdapter({
			agent: capturing.agent,
			stateful: false,
		});
		await collectEvents(adapter, {
			...baseInput,
			messages: [
				{ id: "1", role: "user", content: "hello" },
				{ id: "2", role: "assistant", content: "hi" },
				{ id: "3", role: "user", content: "bye" },
			],
		});

		// stateful: false should send all messages
		expect(capturing.getMessages()).toHaveLength(3);
	});

	it("does not apply stateful filter on resume Command path", async () => {
		let capturedInput: unknown = null;
		const capturingAgent = {
			streamEvents: (input: unknown, _opts: unknown) => {
				capturedInput = input;
				return {
					async *[Symbol.asyncIterator]() {
						// empty stream
					},
				};
			},
		} as never;

		const adapter = new LangChainAgentAdapter({
			agent: capturingAgent,
			stateful: true,
		});
		await collectEvents(adapter, {
			...baseInput,
			messages: [
				{ id: "1", role: "user", content: "hello" },
				{ id: "2", role: "assistant", content: "approve?" },
			],
			forwardedProps: { command: { resume: "approved" } },
		});

		// Resume path should use Command, not filtered messages
		const cmd = capturedInput as { lg_name?: string; resume?: unknown };
		expect(cmd.lg_name).toBe("Command");
		expect(cmd.resume).toBe("approved");
	});

	it("clone() preserves stateful flag", async () => {
		const capturing = makeCapturingAgent();
		const original = new LangChainAgentAdapter({
			agent: capturing.agent,
			stateful: true,
		});
		const cloned = original.clone();

		await collectEvents(cloned, {
			...baseInput,
			messages: [
				{ id: "1", role: "user", content: "hello" },
				{ id: "2", role: "assistant", content: "hi" },
				{ id: "3", role: "user", content: "OK" },
			],
		});

		// Cloned adapter should also filter (stateful preserved)
		const messages = capturing.getMessages();
		expect(messages).toHaveLength(1);
		expect((messages[0] as { content: string }).content).toBe("OK");
	});

	it("returns empty messages when no new user message after last assistant", async () => {
		const capturing = makeCapturingAgent();
		const adapter = new LangChainAgentAdapter({
			agent: capturing.agent,
			stateful: true,
		});
		await collectEvents(adapter, {
			...baseInput,
			messages: [
				{ id: "1", role: "user", content: "hello" },
				{ id: "2", role: "assistant", content: "hi there" },
			],
		});

		// No new user message after assistant — empty input
		expect(capturing.getMessages()).toHaveLength(0);
	});

	it("sends messages after last tool message in stateful mode", async () => {
		const capturing = makeCapturingAgent();
		const adapter = new LangChainAgentAdapter({
			agent: capturing.agent,
			stateful: true,
		});
		await collectEvents(adapter, {
			...baseInput,
			messages: [
				{ id: "1", role: "user", content: "hello" },
				{ id: "2", role: "assistant", content: "" },
				{ id: "3", role: "tool", content: "result", toolCallId: "tc_1" },
				{ id: "4", role: "user", content: "thanks" },
			],
		});

		// tool is treated like assistant for filtering
		const messages = capturing.getMessages();
		expect(messages).toHaveLength(1);
		expect((messages[0] as { content: string }).content).toBe("thanks");
	});
});

describe("interrupt edge cases", () => {
	it("silently handles getState() exceptions", async () => {
		const mockAgent = {
			streamEvents: async function* (_input: unknown, _options: unknown) {
				// empty stream
			},
			getState: async () => {
				throw new Error("state fetch failed");
			},
		} as never;

		const agent = new LangChainAgentAdapter({ agent: mockAgent });
		const events = await collectEvents(agent, baseInput);

		// Should still complete successfully
		expect(events[0].type).toBe(EventType.RUN_STARTED);
		expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
		// No CUSTOM or RUN_ERROR
		expect(events.some((e) => e.type === EventType.CUSTOM)).toBe(false);
		expect(events.some((e) => e.type === EventType.RUN_ERROR)).toBe(false);
	});

	it("skips interrupt check when getState is not defined", async () => {
		const mockAgent = {
			streamEvents: async function* (_input: unknown, _options: unknown) {
				// empty stream — no getState method
			},
		} as never;

		const agent = new LangChainAgentAdapter({ agent: mockAgent });
		const events = await collectEvents(agent, baseInput);

		expect(events[0].type).toBe(EventType.RUN_STARTED);
		expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
		expect(events.some((e) => e.type === EventType.CUSTOM)).toBe(false);
	});

	it("emits TOOL_CALL_RESULT for pending tool calls on interrupt", async () => {
		const mockAgent = {
			streamEvents: async function* (_input: unknown, _options: unknown) {
				// Tool call streamed but no tool execution (interrupted)
				yield {
					event: "on_chain_start",
					name: "agent",
					data: {},
					run_id: "r1",
					metadata: { langgraph_node: "agent" },
				};
				yield {
					event: "on_chat_model_stream",
					name: "ChatAnthropic",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [
								{ name: "send_email", args: "{}", id: "tc_1", index: 0 },
							],
						},
					},
					run_id: "r2",
					metadata: { langgraph_node: "agent" },
				};
				yield {
					event: "on_chat_model_end",
					name: "ChatAnthropic",
					data: {},
					run_id: "r2",
					metadata: { langgraph_node: "agent" },
				};
				yield {
					event: "on_chain_end",
					name: "agent",
					data: { output: {} },
					run_id: "r1",
					metadata: { langgraph_node: "agent" },
				};
			},
			getState: async () => ({
				tasks: [
					{
						interrupts: [
							{
								value: {
									action: "send_email",
									args: { to: "test@example.com" },
								},
							},
						],
					},
				],
			}),
		} as never;

		const agent = new LangChainAgentAdapter({ agent: mockAgent });
		const events = await collectEvents(agent, baseInput);

		// Should have TOOL_CALL_RESULT with "Awaiting approval"
		const toolResults = events.filter(
			(e) => e.type === EventType.TOOL_CALL_RESULT,
		);
		expect(toolResults).toHaveLength(1);
		expect(
			(toolResults[0] as unknown as { toolCallId: string }).toolCallId,
		).toBe("tc_1");
		expect((toolResults[0] as unknown as { content: string }).content).toBe(
			"Awaiting approval",
		);

		// Should also have CUSTOM interrupt
		const customEvent = events.find((e) => e.type === EventType.CUSTOM);
		expect(customEvent).toBeDefined();
	});

	it("does not emit CUSTOM when interrupts array is empty", async () => {
		const mockAgent = {
			streamEvents: async function* (_input: unknown, _options: unknown) {
				// empty stream
			},
			getState: async () => ({
				tasks: [{ interrupts: [] }],
			}),
		} as never;

		const agent = new LangChainAgentAdapter({ agent: mockAgent });
		const events = await collectEvents(agent, baseInput);

		expect(events.some((e) => e.type === EventType.CUSTOM)).toBe(false);
		expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
	});
});

describe("resume edge cases", () => {
	it("parses JSON string resume value", async () => {
		let capturedInput: unknown = null;
		const capturingAgent = {
			streamEvents: (input: unknown, _opts: unknown) => {
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
			forwardedProps: {
				command: {
					resume: JSON.stringify({
						decisions: [{ type: "approve" }],
					}),
				},
			},
		});

		const cmd = capturedInput as { lg_name?: string; resume?: unknown };
		expect(cmd.lg_name).toBe("Command");
		// Should be parsed object, not string
		expect(typeof cmd.resume).toBe("object");
		expect(cmd.resume).toEqual({
			decisions: [{ type: "approve" }],
		});
	});

	it("keeps invalid JSON resume as string", async () => {
		let capturedInput: unknown = null;
		const capturingAgent = {
			streamEvents: (input: unknown, _opts: unknown) => {
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
			forwardedProps: {
				command: { resume: "not valid json" },
			},
		});

		const cmd = capturedInput as { resume?: unknown };
		expect(cmd.resume).toBe("not valid json");
	});
});

describe("configuration", () => {
	it("passes thread_id in configurable", async () => {
		let capturedOpts: Record<string, unknown> | null = null;
		const capturingAgent = {
			streamEvents: (_input: unknown, opts: Record<string, unknown>) => {
				capturedOpts = opts;
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
			threadId: "my-thread-123",
		});

		expect(capturedOpts).not.toBeNull();
		const configurable = (
			capturedOpts as unknown as { configurable: { thread_id: string } }
		).configurable;
		expect(configurable.thread_id).toBe("my-thread-123");
	});
});

describe("error handling", () => {
	it("finalizes open events before emitting RUN_ERROR", async () => {
		const failingAgent = {
			streamEvents: async function* () {
				yield {
					event: "on_chain_start",
					name: "agent",
					data: {},
					run_id: "r1",
					metadata: { langgraph_node: "agent" },
				};
				yield {
					event: "on_chat_model_stream",
					name: "ChatAnthropic",
					data: { chunk: { content: "partial" } },
					run_id: "r2",
					metadata: { langgraph_node: "agent" },
				};
				throw new Error("mid-stream failure");
			},
		} as never;

		const agent = new LangChainAgentAdapter({ agent: failingAgent });
		const events = await collectEvents(agent, baseInput);

		const types = events.map((e) => e.type);

		// Should have finalize events (TEXT_MESSAGE_END, STEP_FINISHED) before RUN_ERROR
		const textEndIdx = types.indexOf(EventType.TEXT_MESSAGE_END);
		const stepFinishedIdx = types.indexOf(EventType.STEP_FINISHED);
		const errorIdx = types.indexOf(EventType.RUN_ERROR);

		expect(textEndIdx).toBeGreaterThan(-1);
		expect(stepFinishedIdx).toBeGreaterThan(-1);
		expect(errorIdx).toBeGreaterThan(textEndIdx);
		expect(errorIdx).toBeGreaterThan(stepFinishedIdx);
	});

	it("aborts stream on unsubscribe", async () => {
		let yieldCount = 0;
		const slowAgent = {
			streamEvents: async function* () {
				for (let i = 0; i < 100; i++) {
					yieldCount++;
					yield {
						event: "on_chat_model_stream",
						name: "ChatAnthropic",
						data: { chunk: { content: `chunk ${i}` } },
						run_id: "r1",
						metadata: {},
					};
					// Small delay to allow unsubscribe to take effect
					await new Promise((resolve) => setTimeout(resolve, 1));
				}
			},
		} as never;

		const agent = new LangChainAgentAdapter({ agent: slowAgent });
		const collected: BaseEvent[] = [];

		await new Promise<void>((resolve) => {
			const sub = agent.run(baseInput).subscribe({
				next(event) {
					collected.push(event);
					// Unsubscribe after a few events
					if (collected.length >= 5) {
						sub.unsubscribe();
						resolve();
					}
				},
				complete() {
					resolve();
				},
			});
		});

		// Should have stopped early
		expect(collected.length).toBeLessThan(50);
	});
});
