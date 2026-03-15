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
		it("emits TOOL_CALL_START when a tool call begins (with synthetic parent message)", () => {
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

			// Synthetic parent message (START+END) + TOOL_CALL_START + TOOL_CALL_ARGS
			expect(events).toHaveLength(4);
			expect(events[0].type).toBe(EventType.TEXT_MESSAGE_START);
			expect(events[1].type).toBe(EventType.TEXT_MESSAGE_END);
			expect(events[2].type).toBe(EventType.TOOL_CALL_START);
			expect(
				(events[2] as unknown as { toolCallName: string }).toolCallName,
			).toBe("search");
			expect(events[3].type).toBe(EventType.TOOL_CALL_ARGS);
			expect((events[3] as unknown as { delta: string }).delta).toBe('{"q":');
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

		it("resolves mismatched tool_call_id via pending queue", () => {
			const mapper = new EventMapper();

			// Emit TOOL_CALL_START with streaming ID
			mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [
								{ name: "write_file", args: "{}", id: "toolu_AAA", index: 0 },
							],
						},
					},
				}),
			);

			// Tool result arrives with a different (LangGraph-generated) ID
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_tool_end",
					name: "write_file",
					data: {
						output: {
							content: "ok",
							tool_call_id: "019ceb76-xxxx",
							id: "msg_2",
						},
					},
				}),
			);

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe(EventType.TOOL_CALL_RESULT);
			// Should use the streaming ID, not the mismatched one
			expect((events[0] as unknown as { toolCallId: string }).toolCallId).toBe(
				"toolu_AAA",
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

		it("handles nested chain events with same name via depth tracking", () => {
			const mapper = new EventMapper();

			// Outer chain start for "tools"
			const start1 = mapper.mapEvent(
				makeEvent({
					event: "on_chain_start",
					name: "tools",
					metadata: { langgraph_node: "tools" },
				}),
			);
			expect(start1).toHaveLength(1);
			expect(start1[0].type).toBe(EventType.STEP_STARTED);

			// Nested inner chain start with same name — should NOT emit STEP_STARTED
			const start2 = mapper.mapEvent(
				makeEvent({
					event: "on_chain_start",
					name: "tools",
					metadata: { langgraph_node: "tools" },
				}),
			);
			expect(start2).toHaveLength(0);

			// Inner chain end — should NOT emit STEP_FINISHED (depth > 0)
			const end1 = mapper.mapEvent(
				makeEvent({
					event: "on_chain_end",
					name: "tools",
					metadata: { langgraph_node: "tools" },
				}),
			);
			expect(end1).toHaveLength(0);

			// Outer chain end — should emit STEP_FINISHED (depth == 0)
			const end2 = mapper.mapEvent(
				makeEvent({
					event: "on_chain_end",
					name: "tools",
					metadata: { langgraph_node: "tools" },
				}),
			);
			expect(end2).toHaveLength(1);
			expect(end2[0].type).toBe(EventType.STEP_FINISHED);
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

			// First chunk: has id — includes synthetic parent message
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
			expect(first).toHaveLength(4); // parent START+END + TOOL_CALL_START + ARGS
			expect((first[2] as unknown as { toolCallId: string }).toolCallId).toBe(
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

			// First chunk: two tool calls start (includes synthetic parent message)
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
			expect(first).toHaveLength(6); // parent START+END + 2x TOOL_CALL_START + 2x ARGS

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

	describe("buffered tool call args", () => {
		it("buffers args arriving before name, flushes after TOOL_CALL_START", () => {
			const mapper = new EventMapper();

			// Chunk 1: args arrive without name
			const first = mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [{ args: '{"q":', id: "tc_1", index: 0 }],
						},
					},
				}),
			);
			// No events emitted — args are buffered
			expect(first).toHaveLength(0);

			// Chunk 2: name arrives
			const second = mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [
								{ name: "search", args: '"test"}', id: "tc_1", index: 0 },
							],
						},
					},
				}),
			);
			// Parent START+END + TOOL_CALL_START + buffered args flush + new args
			expect(second).toHaveLength(5);
			expect(second[0].type).toBe(EventType.TEXT_MESSAGE_START);
			expect(second[1].type).toBe(EventType.TEXT_MESSAGE_END);
			expect(second[2].type).toBe(EventType.TOOL_CALL_START);
			expect(second[3].type).toBe(EventType.TOOL_CALL_ARGS);
			expect((second[3] as unknown as { delta: string }).delta).toBe('{"q":');
			expect(second[4].type).toBe(EventType.TOOL_CALL_ARGS);
			expect((second[4] as unknown as { delta: string }).delta).toBe('"test"}');
		});
	});

	describe("Command object in on_tool_end", () => {
		it("extracts content from Command update.messages", () => {
			const mapper = new EventMapper();
			// Start the tool call first
			mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [
								{ name: "write_file", args: "{}", id: "tc_1", index: 0 },
							],
						},
					},
				}),
			);

			const events = mapper.mapEvent(
				makeEvent({
					event: "on_tool_end",
					name: "write_file",
					data: {
						output: {
							lg_name: "Command",
							update: {
								messages: [
									{
										content: "File written successfully",
										tool_call_id: "tc_1",
									},
								],
							},
						},
					},
				}),
			);

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe(EventType.TOOL_CALL_RESULT);
			expect((events[0] as unknown as { content: string }).content).toBe(
				"File written successfully",
			);
			expect((events[0] as unknown as { toolCallId: string }).toolCallId).toBe(
				"tc_1",
			);
		});

		it("handles raw string output from tool", () => {
			const mapper = new EventMapper();
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_tool_end",
					name: "simple_tool",
					data: { output: "plain text result" },
				}),
			);

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe(EventType.TOOL_CALL_RESULT);
			expect((events[0] as unknown as { content: string }).content).toBe(
				"plain text result",
			);
		});
	});

	describe("full ReAct loop", () => {
		it("emits correct event sequence: agent(tool) → tools(exec) → agent(text)", () => {
			const mapper = new EventMapper();
			const all: Array<{ type: string }> = [];
			const collect = (events: Array<{ type: string }>) => all.push(...events);

			// 1. Agent node starts
			collect(
				mapper.mapEvent(
					makeEvent({
						event: "on_chain_start",
						name: "agent",
						metadata: { langgraph_node: "agent" },
					}),
				),
			);

			// 2. LLM streams tool call
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
										args: '{"q":"cats"}',
										id: "tc_1",
										index: 0,
									},
								],
							},
						},
					}),
				),
			);

			// 3. LLM ends
			collect(mapper.mapEvent(makeEvent({ event: "on_chat_model_end" })));

			// 4. Agent node ends
			collect(
				mapper.mapEvent(
					makeEvent({
						event: "on_chain_end",
						name: "agent",
						metadata: { langgraph_node: "agent" },
					}),
				),
			);

			// 5. Tools node starts
			collect(
				mapper.mapEvent(
					makeEvent({
						event: "on_chain_start",
						name: "tools",
						metadata: { langgraph_node: "tools" },
					}),
				),
			);

			// 6. Tool execution ends
			collect(
				mapper.mapEvent(
					makeEvent({
						event: "on_tool_end",
						name: "search",
						data: {
							output: {
								content: "Found 10 results",
								tool_call_id: "tc_1",
							},
						},
					}),
				),
			);

			// 7. Tools node ends
			collect(
				mapper.mapEvent(
					makeEvent({
						event: "on_chain_end",
						name: "tools",
						metadata: { langgraph_node: "tools" },
					}),
				),
			);

			// 8. Agent node starts again (second turn)
			collect(
				mapper.mapEvent(
					makeEvent({
						event: "on_chain_start",
						name: "agent",
						metadata: { langgraph_node: "agent" },
					}),
				),
			);

			// 9. LLM streams text response
			collect(
				mapper.mapEvent(
					makeEvent({
						event: "on_chat_model_stream",
						data: { chunk: { content: "Here are the results" } },
					}),
				),
			);

			// 10. LLM ends
			collect(mapper.mapEvent(makeEvent({ event: "on_chat_model_end" })));

			// 11. Agent node ends
			collect(
				mapper.mapEvent(
					makeEvent({
						event: "on_chain_end",
						name: "agent",
						metadata: { langgraph_node: "agent" },
					}),
				),
			);

			// Verify event types in order
			const types = all.map((e) => e.type);
			expect(types).toEqual([
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
				EventType.STEP_STARTED, // agent (2nd)
				EventType.TEXT_MESSAGE_START,
				EventType.TEXT_MESSAGE_CONTENT,
				EventType.TEXT_MESSAGE_END,
				EventType.STEP_FINISHED, // agent (2nd)
			]);

			// Verify the text content
			const textContent = all.find(
				(e) => e.type === EventType.TEXT_MESSAGE_CONTENT,
			);
			expect((textContent as unknown as { delta: string }).delta).toBe(
				"Here are the results",
			);

			// Verify tool result content
			const toolResult = all.find((e) => e.type === EventType.TOOL_CALL_RESULT);
			expect((toolResult as unknown as { content: string }).content).toBe(
				"Found 10 results",
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

		it("closes open tool calls", () => {
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

			const events = mapper.finalize();
			const toolCallEnd = events.find(
				(e) => e.type === EventType.TOOL_CALL_END,
			);
			expect(toolCallEnd).toBeDefined();
			expect(
				(toolCallEnd as unknown as { toolCallId: string }).toolCallId,
			).toBe("tc_1");
		});

		it("returns empty array when nothing is open", () => {
			const mapper = new EventMapper();
			const events = mapper.finalize();
			expect(events).toHaveLength(0);
		});
	});

	describe("drainPendingToolCallIds", () => {
		it("returns pending IDs and clears the queue", () => {
			const mapper = new EventMapper();
			mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [
								{ name: "search", args: "{}", id: "tc_1", index: 0 },
								{ name: "calc", args: "{}", id: "tc_2", index: 1 },
							],
						},
					},
				}),
			);

			const ids = mapper.drainPendingToolCallIds();
			expect(ids).toEqual(["tc_1", "tc_2"]);

			// Second call should return empty
			const ids2 = mapper.drainPendingToolCallIds();
			expect(ids2).toEqual([]);
		});
	});

	describe("node transitions", () => {
		it("auto-closes previous step when a new node starts", () => {
			const mapper = new EventMapper();
			mapper.mapEvent(
				makeEvent({
					event: "on_chain_start",
					name: "agent",
					metadata: { langgraph_node: "agent" },
				}),
			);

			// New node starts without agent ending
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chain_start",
					name: "tools",
					metadata: { langgraph_node: "tools" },
				}),
			);

			expect(events).toHaveLength(2);
			expect(events[0].type).toBe(EventType.STEP_FINISHED);
			expect((events[0] as unknown as { stepName: string }).stepName).toBe(
				"agent",
			);
			expect(events[1].type).toBe(EventType.STEP_STARTED);
			expect((events[1] as unknown as { stepName: string }).stepName).toBe(
				"tools",
			);
		});
	});

	describe("state accumulation and merge", () => {
		it("accumulates state across multiple steps", () => {
			const mapper = new EventMapper(["messages", "count"]);

			// Step 1
			mapper.mapEvent(
				makeEvent({
					event: "on_chain_start",
					name: "agent",
					metadata: { langgraph_node: "agent" },
				}),
			);
			const step1 = mapper.mapEvent(
				makeEvent({
					event: "on_chain_end",
					name: "agent",
					metadata: { langgraph_node: "agent" },
					data: {
						output: {
							messages: [{ role: "assistant", content: "first" }],
							count: 1,
						},
					},
				}),
			);
			const snapshot1 = (
				step1.find((e) => e.type === EventType.STATE_SNAPSHOT) as unknown as {
					snapshot: Record<string, unknown>;
				}
			).snapshot;
			expect(snapshot1.count).toBe(1);

			// Step 2: array should concatenate, scalar should overwrite
			mapper.mapEvent(
				makeEvent({
					event: "on_chain_start",
					name: "tools",
					metadata: { langgraph_node: "tools" },
				}),
			);
			const step2 = mapper.mapEvent(
				makeEvent({
					event: "on_chain_end",
					name: "tools",
					metadata: { langgraph_node: "tools" },
					data: {
						output: {
							messages: [{ role: "tool", content: "result" }],
							count: 2,
						},
					},
				}),
			);
			const snapshot2 = (
				step2.find((e) => e.type === EventType.STATE_SNAPSHOT) as unknown as {
					snapshot: Record<string, unknown>;
				}
			).snapshot;
			// Arrays concatenated
			expect(snapshot2.messages).toEqual([
				{ role: "assistant", content: "first" },
				{ role: "tool", content: "result" },
			]);
			// Scalar overwritten
			expect(snapshot2.count).toBe(2);
		});
	});

	describe("edge cases", () => {
		it("on_tool_end with no output returns empty array", () => {
			const mapper = new EventMapper();
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_tool_end",
					name: "search",
					data: { output: undefined },
				}),
			);
			expect(events).toHaveLength(0);
		});

		it("handles non-string ToolMessage content via JSON.stringify", () => {
			const mapper = new EventMapper();
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_tool_end",
					name: "search",
					data: {
						output: {
							content: { results: [1, 2, 3] },
							tool_call_id: "tc_1",
						},
					},
				}),
			);

			expect(events).toHaveLength(1);
			expect((events[0] as unknown as { content: string }).content).toBe(
				JSON.stringify({ results: [1, 2, 3] }),
			);
		});

		it("Command with empty messages array uses serialized update", () => {
			const mapper = new EventMapper();
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_tool_end",
					name: "tool",
					data: {
						output: {
							lg_name: "Command",
							update: { messages: [] },
						},
					},
				}),
			);

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe(EventType.TOOL_CALL_RESULT);
			expect((events[0] as unknown as { content: string }).content).toBe(
				JSON.stringify({ messages: [] }),
			);
		});

		it("on_chat_model_stream with missing chunk returns empty array", () => {
			const mapper = new EventMapper();
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {},
				}),
			);
			expect(events).toHaveLength(0);
		});

		it("resolves parallel tool call results in correct order", () => {
			const mapper = new EventMapper();

			// Start two tool calls
			mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [
								{ name: "search", args: "{}", id: "tc_A", index: 0 },
								{ name: "calc", args: "{}", id: "tc_B", index: 1 },
							],
						},
					},
				}),
			);
			mapper.mapEvent(makeEvent({ event: "on_chat_model_end" }));

			// Results arrive in order
			const result1 = mapper.mapEvent(
				makeEvent({
					event: "on_tool_end",
					name: "search",
					data: {
						output: { content: "search result", tool_call_id: "tc_A" },
					},
				}),
			);
			expect((result1[0] as unknown as { toolCallId: string }).toolCallId).toBe(
				"tc_A",
			);

			const result2 = mapper.mapEvent(
				makeEvent({
					event: "on_tool_end",
					name: "calc",
					data: {
						output: { content: "calc result", tool_call_id: "tc_B" },
					},
				}),
			);
			expect((result2[0] as unknown as { toolCallId: string }).toolCallId).toBe(
				"tc_B",
			);
		});

		it("handles same tool called multiple times with different indexes", () => {
			const mapper = new EventMapper();

			// Same tool name, different index/id
			const events = mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [
								{ name: "search", args: '{"q":"cats"}', id: "tc_1", index: 0 },
								{
									name: "search",
									args: '{"q":"dogs"}',
									id: "tc_2",
									index: 1,
								},
							],
						},
					},
				}),
			);

			const starts = events.filter((e) => e.type === EventType.TOOL_CALL_START);
			expect(starts).toHaveLength(2);
			expect((starts[0] as unknown as { toolCallId: string }).toolCallId).toBe(
				"tc_1",
			);
			expect((starts[1] as unknown as { toolCallId: string }).toolCallId).toBe(
				"tc_2",
			);
		});

		it("kwargs-style ToolMessage in on_chain_end is correctly extracted", () => {
			const mapper = new EventMapper();

			// Start tool call
			mapper.mapEvent(
				makeEvent({
					event: "on_chat_model_stream",
					data: {
						chunk: {
							content: "",
							tool_call_chunks: [
								{ name: "write_todos", args: "{}", id: "toolu_AAA", index: 0 },
							],
						},
					},
				}),
			);
			mapper.mapEvent(makeEvent({ event: "on_chat_model_end" }));

			// on_chain_end with kwargs-style
			mapper.mapEvent(
				makeEvent({
					event: "on_chain_start",
					name: "model_request",
					metadata: { langgraph_node: "model_request" },
				}),
			);
			const events = mapper.mapEvent(
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
											kwargs: {
												content: "Done",
												tool_call_id: "toolu_AAA",
											},
										},
									],
								},
							},
						],
					},
				}),
			);

			const result = events.find((e) => e.type === EventType.TOOL_CALL_RESULT);
			expect(result).toBeDefined();
			expect((result as unknown as { content: string }).content).toBe("Done");
			expect((result as unknown as { toolCallId: string }).toolCallId).toBe(
				"toolu_AAA",
			);
		});
	});

	describe("subgraph execution", () => {
		it("handles parent → child graph node transitions", () => {
			const mapper = new EventMapper();
			const all: Array<{ type: string; stepName?: string }> = [];
			const collect = (events: Array<{ type: string }>) => all.push(...events);

			// Parent node starts
			collect(
				mapper.mapEvent(
					makeEvent({
						event: "on_chain_start",
						name: "orchestrator",
						metadata: { langgraph_node: "orchestrator" },
					}),
				),
			);

			// Child graph node starts (different langgraph_node)
			collect(
				mapper.mapEvent(
					makeEvent({
						event: "on_chain_start",
						name: "sub_agent",
						metadata: { langgraph_node: "sub_agent" },
					}),
				),
			);

			// Child graph node ends
			collect(
				mapper.mapEvent(
					makeEvent({
						event: "on_chain_end",
						name: "sub_agent",
						metadata: { langgraph_node: "sub_agent" },
					}),
				),
			);

			const types = all.map((e) => e.type);
			expect(types).toEqual([
				EventType.STEP_STARTED, // orchestrator
				EventType.STEP_FINISHED, // orchestrator (auto-closed)
				EventType.STEP_STARTED, // sub_agent
				EventType.STEP_FINISHED, // sub_agent
			]);

			// Verify step names
			expect((all[0] as unknown as { stepName: string }).stepName).toBe(
				"orchestrator",
			);
			expect((all[1] as unknown as { stepName: string }).stepName).toBe(
				"orchestrator",
			);
			expect((all[2] as unknown as { stepName: string }).stepName).toBe(
				"sub_agent",
			);
			expect((all[3] as unknown as { stepName: string }).stepName).toBe(
				"sub_agent",
			);
		});
	});
});
