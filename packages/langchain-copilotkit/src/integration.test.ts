/**
 * Integration tests that validate EventMapper output against CopilotKit's
 * AG-UI event processing pipeline (verifyEvents + defaultApplyEvents).
 *
 * These tests import the actual @ag-ui/client functions to ensure our events
 * pass the same validation the CopilotKit frontend applies.
 */
import { describe, expect, it } from "bun:test";
import {
	type AbstractAgent,
	type AgentSubscriber,
	type BaseEvent,
	EventType,
	type Message,
	type RunAgentInput,
	type State,
	defaultApplyEvents,
	verifyEvents,
} from "@ag-ui/client";
import { Observable, lastValueFrom, toArray } from "rxjs";
import { EventMapper } from "./event_mapper";

// ── Helpers ────────────────────────────────────────────────

interface StreamEvent extends Record<string, unknown> {
	event: string;
	name: string;
	data: Record<string, unknown>;
	run_id: string;
	tags?: string[];
	metadata?: Record<string, unknown>;
}

function makeEvent(partial: Partial<StreamEvent>): StreamEvent {
	return {
		event: "",
		name: "",
		data: {},
		run_id: crypto.randomUUID(),
		tags: [],
		metadata: {},
		...partial,
	};
}

/** Emit events through verifyEvents and collect; throws if validation fails. */
async function verifyEventStream(events: BaseEvent[]): Promise<BaseEvent[]> {
	const source$ = new Observable<BaseEvent>((subscriber) => {
		for (const e of events) subscriber.next(e);
		subscriber.complete();
	});
	return lastValueFrom(source$.pipe(verifyEvents(false)).pipe(toArray()));
}

/** Emit events through defaultApplyEvents and return final messages + state. */
async function applyEventStream(
	events: BaseEvent[],
): Promise<{ messages: Message[]; state: State }> {
	const input: RunAgentInput = {
		threadId: "t1",
		runId: "r1",
		messages: [],
		state: {},
		tools: [],
		context: [],
		forwardedProps: {},
	};

	// Minimal agent stub for defaultApplyEvents
	const agent = {
		messages: [] as Message[],
		state: {} as State,
	} as unknown as AbstractAgent;

	const source$ = new Observable<BaseEvent>((subscriber) => {
		for (const e of events) subscriber.next(e);
		subscriber.complete();
	});

	const finalMessages = [...input.messages];
	const finalState = { ...input.state };

	const mutations$ = defaultApplyEvents(input, source$, agent, []);
	await lastValueFrom(
		new Observable((subscriber) => {
			mutations$.subscribe({
				next: (mutation) => {
					if (mutation.messages) {
						finalMessages.length = 0;
						finalMessages.push(...mutation.messages);
					}
					if (mutation.state) {
						Object.assign(finalState, mutation.state);
					}
					subscriber.next(mutation);
				},
				error: (err) => subscriber.error(err),
				complete: () => subscriber.complete(),
			});
		}).pipe(toArray()),
	);

	return { messages: finalMessages, state: finalState };
}

// ── Scenario helpers ──────────────────────────────────────

/** Simulate: LLM produces text only (no tool calls). */
function textOnlyScenario(): BaseEvent[] {
	const mapper = new EventMapper();
	const all: BaseEvent[] = [];
	const collect = (evts: BaseEvent[]) => all.push(...evts);

	// RUN_STARTED
	all.push({
		type: EventType.RUN_STARTED,
		threadId: "t1",
		runId: "r1",
	} as BaseEvent);

	// Agent node starts
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_start",
				name: "agent",
				metadata: { langgraph_node: "agent" },
			}),
		),
	);

	// LLM streams text
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chat_model_stream",
				data: { chunk: { content: "Hello world" } },
			}),
		),
	);

	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chat_model_stream",
				data: { chunk: { content: "!" } },
			}),
		),
	);

	// LLM ends
	collect(mapper.mapEvent(makeEvent({ event: "on_chat_model_end" })));

	// Agent node ends
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_end",
				name: "agent",
				metadata: { langgraph_node: "agent" },
			}),
		),
	);

	// Finalize
	collect(mapper.finalize());

	// RUN_FINISHED
	all.push({
		type: EventType.RUN_FINISHED,
		threadId: "t1",
		runId: "r1",
	} as BaseEvent);

	return all;
}

/** Simulate: LLM calls a tool, tool returns result, LLM responds with text. */
function toolCallReActScenario(): BaseEvent[] {
	const mapper = new EventMapper();
	const all: BaseEvent[] = [];
	const collect = (evts: BaseEvent[]) => all.push(...evts);

	all.push({
		type: EventType.RUN_STARTED,
		threadId: "t1",
		runId: "r1",
	} as BaseEvent);

	// Agent node: LLM generates tool call (no text)
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_start",
				name: "agent",
				metadata: { langgraph_node: "agent" },
			}),
		),
	);
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chat_model_stream",
				data: {
					chunk: {
						content: "",
						tool_call_chunks: [
							{
								name: "search",
								args: '{"query":"test"}',
								id: "tc_1",
								index: 0,
							},
						],
					},
				},
			}),
		),
	);
	collect(mapper.mapEvent(makeEvent({ event: "on_chat_model_end" })));
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_end",
				name: "agent",
				metadata: { langgraph_node: "agent" },
			}),
		),
	);

	// Tools node: tool executes
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_start",
				name: "tools",
				metadata: { langgraph_node: "tools" },
			}),
		),
	);
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_tool_end",
				name: "search",
				data: {
					output: {
						content: "Found 5 results for test",
						tool_call_id: "tc_1",
					},
				},
			}),
		),
	);
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_end",
				name: "tools",
				metadata: { langgraph_node: "tools" },
			}),
		),
	);

	// Agent node: LLM generates final text response
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_start",
				name: "agent",
				metadata: { langgraph_node: "agent" },
			}),
		),
	);
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chat_model_stream",
				data: { chunk: { content: "Here are the results." } },
			}),
		),
	);
	collect(mapper.mapEvent(makeEvent({ event: "on_chat_model_end" })));
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_end",
				name: "agent",
				metadata: { langgraph_node: "agent" },
			}),
		),
	);

	collect(mapper.finalize());

	all.push({
		type: EventType.RUN_FINISHED,
		threadId: "t1",
		runId: "r1",
	} as BaseEvent);

	return all;
}

/** Simulate: deepagents pattern — Command objects in on_chain_end instead of on_tool_end. */
function deepagentsCommandScenario(): BaseEvent[] {
	const mapper = new EventMapper();
	const all: BaseEvent[] = [];
	const collect = (evts: BaseEvent[]) => all.push(...evts);

	all.push({
		type: EventType.RUN_STARTED,
		threadId: "t1",
		runId: "r1",
	} as BaseEvent);

	// model_request node: LLM generates tool call
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_start",
				name: "model_request",
				metadata: { langgraph_node: "model_request" },
			}),
		),
	);
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chat_model_stream",
				data: {
					chunk: {
						content: [],
						tool_call_chunks: [
							{
								name: "write_todos",
								args: '{"todos":[{"content":"test","status":"pending"}]}',
								id: "toolu_AAA",
								index: 0,
							},
						],
					},
				},
			}),
		),
	);
	collect(mapper.mapEvent(makeEvent({ event: "on_chat_model_end" })));
	// on_chain_end with Command output (no on_tool_end fires)
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_end",
				name: "model_request",
				metadata: { langgraph_node: "model_request" },
				data: {
					output: [
						{
							lg_name: "Command",
							update: {
								messages: [
									{
										lc: 1,
										type: "constructor",
										id: ["langchain_core", "messages", "ToolMessage"],
										kwargs: {
											content: "Todo list updated",
											tool_call_id: "toolu_AAA",
										},
									},
								],
							},
						},
					],
				},
			}),
		),
	);

	// middleware node (no meaningful events)
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_start",
				name: "middleware",
				metadata: { langgraph_node: "middleware" },
			}),
		),
	);
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_end",
				name: "middleware",
				metadata: { langgraph_node: "middleware" },
			}),
		),
	);

	// model_request node (2nd): LLM generates text response
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_start",
				name: "model_request",
				metadata: { langgraph_node: "model_request" },
			}),
		),
	);
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chat_model_stream",
				data: {
					chunk: {
						content: [{ type: "text", text: "Your todo list is ready!" }],
					},
				},
			}),
		),
	);
	collect(mapper.mapEvent(makeEvent({ event: "on_chat_model_end" })));
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_end",
				name: "model_request",
				metadata: { langgraph_node: "model_request" },
			}),
		),
	);

	collect(mapper.finalize());

	all.push({
		type: EventType.RUN_FINISHED,
		threadId: "t1",
		runId: "r1",
	} as BaseEvent);

	return all;
}

/** Simulate: Text then tool call in same LLM turn. */
function textThenToolScenario(): BaseEvent[] {
	const mapper = new EventMapper();
	const all: BaseEvent[] = [];
	const collect = (evts: BaseEvent[]) => all.push(...evts);

	all.push({
		type: EventType.RUN_STARTED,
		threadId: "t1",
		runId: "r1",
	} as BaseEvent);

	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_start",
				name: "agent",
				metadata: { langgraph_node: "agent" },
			}),
		),
	);

	// LLM streams text first
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chat_model_stream",
				data: { chunk: { content: "Let me search for that." } },
			}),
		),
	);

	// Then tool call in same turn
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chat_model_stream",
				data: {
					chunk: {
						content: "",
						tool_call_chunks: [
							{ name: "search", args: '{"q":"test"}', id: "tc_1", index: 0 },
						],
					},
				},
			}),
		),
	);

	collect(mapper.mapEvent(makeEvent({ event: "on_chat_model_end" })));
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_end",
				name: "agent",
				metadata: { langgraph_node: "agent" },
			}),
		),
	);

	// Tool execution
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_start",
				name: "tools",
				metadata: { langgraph_node: "tools" },
			}),
		),
	);
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_tool_end",
				name: "search",
				data: {
					output: { content: "Results found", tool_call_id: "tc_1" },
				},
			}),
		),
	);
	collect(
		mapper.mapEvent(
			makeEvent({
				event: "on_chain_end",
				name: "tools",
				metadata: { langgraph_node: "tools" },
			}),
		),
	);

	collect(mapper.finalize());

	all.push({
		type: EventType.RUN_FINISHED,
		threadId: "t1",
		runId: "r1",
	} as BaseEvent);

	return all;
}

// ── Tests ─────────────────────────────────────────────────

describe("CopilotKit integration: verifyEvents", () => {
	it("text-only scenario passes verification", async () => {
		const events = textOnlyScenario();
		const verified = await verifyEventStream(events);
		expect(verified.length).toBe(events.length);
	});

	it("ReAct tool call scenario passes verification", async () => {
		const events = toolCallReActScenario();
		const verified = await verifyEventStream(events);
		expect(verified.length).toBe(events.length);
	});

	it("deepagents Command scenario passes verification", async () => {
		const events = deepagentsCommandScenario();
		const verified = await verifyEventStream(events);
		expect(verified.length).toBe(events.length);
	});

	it("text-then-tool scenario passes verification", async () => {
		const events = textThenToolScenario();
		const verified = await verifyEventStream(events);
		expect(verified.length).toBe(events.length);
	});
});

describe("CopilotKit integration: defaultApplyEvents", () => {
	it("text-only scenario produces an assistant message", async () => {
		const events = textOnlyScenario();
		const { messages } = await applyEventStream(events);

		const assistantMsg = messages.find((m) => m.role === "assistant");
		expect(assistantMsg).toBeDefined();
		expect(assistantMsg?.content).toBe("Hello world!");
	});

	it("ReAct scenario produces assistant message with toolCalls, tool result, and final text", async () => {
		const events = toolCallReActScenario();
		const { messages } = await applyEventStream(events);

		// Should have: synthetic parent (with toolCalls), tool result, final text
		const assistantMsgs = messages.filter((m) => m.role === "assistant");
		const toolMsgs = messages.filter((m) => m.role === "tool");

		// At least one assistant message should have toolCalls
		const msgWithToolCalls = assistantMsgs.find(
			(m) => m.toolCalls && m.toolCalls.length > 0,
		);
		expect(msgWithToolCalls).toBeDefined();
		expect(msgWithToolCalls?.toolCalls?.[0].function.name).toBe("search");

		// Tool result message
		expect(toolMsgs.length).toBeGreaterThanOrEqual(1);
		expect(toolMsgs[0].content).toBe("Found 5 results for test");
		expect(toolMsgs[0].toolCallId).toBe("tc_1");

		// Final text message
		const finalText = assistantMsgs.find(
			(m) => typeof m.content === "string" && m.content.includes("results"),
		);
		expect(finalText).toBeDefined();
	});

	it("deepagents Command scenario produces tool result and final text", async () => {
		const events = deepagentsCommandScenario();
		const { messages } = await applyEventStream(events);

		const toolMsgs = messages.filter((m) => m.role === "tool");
		expect(toolMsgs.length).toBeGreaterThanOrEqual(1);
		expect(toolMsgs[0].content).toBe("Todo list updated");

		const finalText = messages.find(
			(m) =>
				m.role === "assistant" &&
				typeof m.content === "string" &&
				m.content.includes("todo list"),
		);
		expect(finalText).toBeDefined();
	});

	it("text-then-tool scenario has parentMessageId linking tool to text message", async () => {
		const events = textThenToolScenario();
		const { messages } = await applyEventStream(events);

		// The text message should also have the tool call attached
		const assistantMsg = messages.find(
			(m) =>
				m.role === "assistant" &&
				"toolCalls" in m &&
				m.toolCalls &&
				m.toolCalls.length > 0,
		);
		expect(assistantMsg).toBeDefined();
		expect(
			(
				assistantMsg as unknown as {
					toolCalls: { function: { name: string } }[];
				}
			).toolCalls[0].function.name,
		).toBe("search");
		// The content should include the text that preceded the tool call
		expect(typeof assistantMsg?.content).toBe("string");
		expect((assistantMsg?.content as string).includes("search")).toBe(true);
	});

	it("TOOL_CALL_START always has a valid parentMessageId", () => {
		// Verify that every TOOL_CALL_START event has parentMessageId set
		for (const scenario of [
			toolCallReActScenario(),
			deepagentsCommandScenario(),
			textThenToolScenario(),
		]) {
			const toolCallStarts = scenario.filter(
				(e) => e.type === EventType.TOOL_CALL_START,
			);
			for (const e of toolCallStarts) {
				const evt = e as unknown as { parentMessageId: string | null };
				expect(evt.parentMessageId).not.toBeNull();
				expect(typeof evt.parentMessageId).toBe("string");
			}
		}
	});

	it("every TOOL_CALL_START has a preceding TEXT_MESSAGE_START with matching messageId", () => {
		for (const scenario of [
			toolCallReActScenario(),
			deepagentsCommandScenario(),
			textThenToolScenario(),
		]) {
			const seenMessageIds = new Set<string>();
			for (const e of scenario) {
				if (e.type === EventType.TEXT_MESSAGE_START) {
					seenMessageIds.add((e as unknown as { messageId: string }).messageId);
				}
				if (e.type === EventType.TOOL_CALL_START) {
					const parentId = (e as unknown as { parentMessageId: string | null })
						.parentMessageId;
					expect(parentId).not.toBeNull();
					expect(seenMessageIds.has(parentId as string)).toBe(true);
				}
			}
		}
	});
});
