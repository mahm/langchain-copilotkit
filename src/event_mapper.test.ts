import { describe, expect, it } from "bun:test";
import { EventType } from "@ag-ui/client";
import { EventMapper } from "./event_mapper";

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

describe("EventMapper", () => {
	describe("text message streaming", () => {
		it("emits TEXT_MESSAGE_START + TEXT_MESSAGE_CONTENT on first text chunk", () => {
			const mapper = new EventMapper();
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					name: "ChatAnthropic",
					metadata: { langgraph_node: "agent" },
					data: { chunk: { content: "Hello" } },
				}),
			);

			expect(events).toHaveLength(2);
			expect(events[0].type).toBe(EventType.TEXT_MESSAGE_START);
			expect((events[0] as unknown as { role: string }).role).toBe("assistant");
			expect(events[1].type).toBe(EventType.TEXT_MESSAGE_CONTENT);
			expect((events[1] as unknown as { delta: string }).delta).toBe("Hello");
		});

		it("emits only TEXT_MESSAGE_CONTENT on subsequent chunks", () => {
			const mapper = new EventMapper();
			mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: { chunk: { content: "Hello" } },
				}),
			);

			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: { chunk: { content: " world" } },
				}),
			);

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe(EventType.TEXT_MESSAGE_CONTENT);
			expect((events[0] as unknown as { delta: string }).delta).toBe(" world");
		});

		it("emits TEXT_MESSAGE_END on chat model end", () => {
			const mapper = new EventMapper();
			mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: { chunk: { content: "Hello" } },
				}),
			);

			const events = mapper.mapEvent(makeEvent({ event: "on_chat_model_end" }));

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe(EventType.TEXT_MESSAGE_END);
		});

		it("skips empty content chunks", () => {
			const mapper = new EventMapper();
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: { chunk: { content: "" } },
				}),
			);
			expect(events).toHaveLength(0);
		});
	});

	describe("tool call streaming", () => {
		it("emits TOOL_CALL_START when a tool call begins", () => {
			const mapper = new EventMapper();
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [
								{ name: "search", args: '{"q":', id: "tc_1", index: 0 },
							],
						},
					},
				}),
			);

			expect(events).toHaveLength(2);
			expect(events[0].type).toBe(EventType.TOOL_CALL_START);
			expect(
				(events[0] as unknown as { toolCallName: string }).toolCallName,
			).toBe("search");
			expect(events[1].type).toBe(EventType.TOOL_CALL_ARGS);
			expect((events[1] as unknown as { delta: string }).delta).toBe('{"q":');
		});

		it("closes text stream before starting tool calls", () => {
			const mapper = new EventMapper();
			mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: { chunk: { content: "thinking..." } },
				}),
			);

			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [
								{ name: "search", args: "", id: "tc_1", index: 0 },
							],
						},
					},
				}),
			);

			expect(events[0].type).toBe(EventType.TEXT_MESSAGE_END);
			expect(events[1].type).toBe(EventType.TOOL_CALL_START);
		});

		it("emits TOOL_CALL_END on chat model end", () => {
			const mapper = new EventMapper();
			mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [
								{ name: "search", args: "{}", id: "tc_1", index: 0 },
							],
						},
					},
				}),
			);

			const events = mapper.mapEvent(makeEvent({ event: "on_chat_model_end" }));

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe(EventType.TOOL_CALL_END);
			expect((events[0] as unknown as { toolCallId: string }).toolCallId).toBe(
				"tc_1",
			);
		});

		it("emits TOOL_CALL_RESULT on tool end", () => {
			const mapper = new EventMapper();
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_tool_end",
					name: "search",
					data: {
						output: {
							content: "result text",
							tool_call_id: "tc_1",
							id: "msg_1",
						},
					},
				}),
			);

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe(EventType.TOOL_CALL_RESULT);
			expect((events[0] as unknown as { content: string }).content).toBe(
				"result text",
			);
			expect((events[0] as unknown as { toolCallId: string }).toolCallId).toBe(
				"tc_1",
			);
		});
	});

	describe("step tracking", () => {
		it("emits STEP_STARTED on node chain start", () => {
			const mapper = new EventMapper();
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chain_start",
					name: "agent",
					metadata: { langgraph_node: "agent" },
				}),
			);

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe(EventType.STEP_STARTED);
			expect((events[0] as unknown as { stepName: string }).stepName).toBe(
				"agent",
			);
		});

		it("emits STEP_FINISHED on node chain end", () => {
			const mapper = new EventMapper();
			mapper.mapEvent(
				makeEvent({
					event: "on_chain_start",
					name: "agent",
					metadata: { langgraph_node: "agent" },
				}),
			);

			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chain_end",
					name: "agent",
					metadata: { langgraph_node: "agent" },
				}),
			);

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe(EventType.STEP_FINISHED);
		});

		it("skips __start__ and __end__ nodes", () => {
			const mapper = new EventMapper();
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chain_start",
					name: "__start__",
					metadata: { langgraph_node: "__start__" },
				}),
			);
			expect(events).toHaveLength(0);
		});

		it("ignores inner chain events (name !== langgraph_node)", () => {
			const mapper = new EventMapper();
			mapper.mapEvent(
				makeEvent({
					event: "on_chain_start",
					name: "agent",
					metadata: { langgraph_node: "agent" },
				}),
			);

			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chain_start",
					name: "RunnableSequence",
					metadata: { langgraph_node: "agent" },
				}),
			);
			expect(events).toHaveLength(0);
		});
	});

	describe("state snapshot", () => {
		it("emits STATE_SNAPSHOT on chain end with stateKeys", () => {
			const mapper = new EventMapper(["messages", "context"]);
			mapper.mapEvent(
				makeEvent({
					event: "on_chain_start",
					name: "agent",
					metadata: { langgraph_node: "agent" },
				}),
			);

			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chain_end",
					name: "agent",
					metadata: { langgraph_node: "agent" },
					data: {
						output: {
							messages: [{ role: "assistant", content: "hi" }],
							context: "some context",
							irrelevant: 123,
						},
					},
				}),
			);

			expect(events).toHaveLength(2);
			expect(events[0].type).toBe(EventType.STATE_SNAPSHOT);
			const snapshot = (
				events[0] as unknown as { snapshot: Record<string, unknown> }
			).snapshot;
			expect(snapshot.messages).toEqual([{ role: "assistant", content: "hi" }]);
			expect(snapshot.context).toBe("some context");
			expect(snapshot).not.toHaveProperty("irrelevant");
			expect(events[1].type).toBe(EventType.STEP_FINISHED);
		});

		it("skips STATE_SNAPSHOT when no matching keys in output", () => {
			const mapper = new EventMapper(["messages"]);
			mapper.mapEvent(
				makeEvent({
					event: "on_chain_start",
					name: "agent",
					metadata: { langgraph_node: "agent" },
				}),
			);

			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chain_end",
					name: "agent",
					metadata: { langgraph_node: "agent" },
					data: { output: { other: 123 } },
				}),
			);

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe(EventType.STEP_FINISHED);
		});
	});

	describe("array content blocks (Anthropic format)", () => {
		it("emits TEXT_MESSAGE_START + CONTENT from text blocks", () => {
			const mapper = new EventMapper();
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: [
								{ type: "text", text: "Hello " },
								{ type: "text", text: "world" },
							],
						},
					},
				}),
			);

			expect(events).toHaveLength(2);
			expect(events[0].type).toBe(EventType.TEXT_MESSAGE_START);
			expect(events[1].type).toBe(EventType.TEXT_MESSAGE_CONTENT);
			expect((events[1] as unknown as { delta: string }).delta).toBe(
				"Hello world",
			);
		});

		it("emits no events for empty array content", () => {
			const mapper = new EventMapper();
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: { chunk: { content: [] } },
				}),
			);
			expect(events).toHaveLength(0);
		});

		it("emits no events for non-text blocks only", () => {
			const mapper = new EventMapper();
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: [{ type: "tool_use", id: "t1", name: "search" }],
						},
					},
				}),
			);
			expect(events).toHaveLength(0);
		});
	});

	describe("multi-chunk tool call (id=null on subsequent chunks)", () => {
		it("resolves toolCallId from index mapping when id is null", () => {
			const mapper = new EventMapper();

			// First chunk: has id
			const first = mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [
								{ name: "search", args: '{"q":', id: "tc_1", index: 0 },
							],
						},
					},
				}),
			);
			expect(first).toHaveLength(2);
			expect((first[0] as unknown as { toolCallId: string }).toolCallId).toBe(
				"tc_1",
			);

			// Subsequent chunk: id is null, same index
			const second = mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [{ args: '"test"}', id: null, index: 0 }],
						},
					},
				}),
			);
			expect(second).toHaveLength(1);
			expect(second[0].type).toBe(EventType.TOOL_CALL_ARGS);
			expect((second[0] as unknown as { toolCallId: string }).toolCallId).toBe(
				"tc_1",
			);
		});
	});

	describe("parallel tool calls", () => {
		it("resolves each index to its own toolCallId", () => {
			const mapper = new EventMapper();

			// First chunk: two tool calls start
			const first = mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [
								{ name: "search", args: '{"q":', id: "tc_A", index: 0 },
								{ name: "calc", args: '{"x":', id: "tc_B", index: 1 },
							],
						},
					},
				}),
			);
			expect(first).toHaveLength(4); // 2x START + 2x ARGS

			// Subsequent chunks: id=null
			const second = mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [
								{ args: '"hello"}', id: null, index: 0 },
								{ args: "1}", id: null, index: 1 },
							],
						},
					},
				}),
			);
			expect(second).toHaveLength(2);
			expect((second[0] as unknown as { toolCallId: string }).toolCallId).toBe(
				"tc_A",
			);
			expect((second[1] as unknown as { toolCallId: string }).toolCallId).toBe(
				"tc_B",
			);
		});
	});

	describe("finalize", () => {
		it("closes open text message and step", () => {
			const mapper = new EventMapper();
			mapper.mapEvent(
				makeEvent({
					event: "on_chain_start",
					name: "agent",
					metadata: { langgraph_node: "agent" },
				}),
			);
			mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: { chunk: { content: "partial" } },
				}),
			);

			const events = mapper.finalize();
			expect(events).toHaveLength(2);
			expect(events[0].type).toBe(EventType.TEXT_MESSAGE_END);
			expect(events[1].type).toBe(EventType.STEP_FINISHED);
		});
	});
});
