import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";

const SKIP_NODES = new Set(["__start__", "__end__"]);

// Internal type for accessing LangChain stream event fields
interface StreamEventInternal {
	event: string;
	name: string;
	// biome-ignore lint/suspicious/noExplicitAny: LangGraph event data varies by event type
	data: any;
	run_id: string;
	tags?: string[];
	metadata?: Record<string, unknown>;
}

/**
 * Maps LangChain stream events to AG-UI BaseEvent arrays.
 *
 * Handles: TEXT_MESSAGE, TOOL_CALL, TOOL_CALL_RESULT, STATE_SNAPSHOT, STEP
 */
export class EventMapper {
	private stateKeys: string[];
	private debug: boolean;
	private activeMessageId: string | null = null;
	private activeToolCalls = new Map<string, boolean>();
	private hasEmittedTextStart = false;
	private currentNode: string | null = null;
	private stepDepth = 0;
	private accumulatedState: Record<string, unknown> = {};
	private toolCallIndexToId = new Map<number, string>();
	/** Ordered queue of tool call IDs from TOOL_CALL_START, consumed by TOOL_CALL_RESULT */
	private pendingToolCallIds: string[] = [];
	/** Buffer for tool call args that arrive before TOOL_CALL_START */
	private bufferedArgs = new Map<string, string>();

	constructor(stateKeys: string[] = [], debug = false) {
		this.stateKeys = stateKeys;
		this.debug = debug;
	}

	mapEvent(rawEvent: Record<string, unknown>): BaseEvent[] {
		const event = rawEvent as unknown as StreamEventInternal;
		if (this.debug) {
			console.debug(
				"[EventMapper] input:",
				event.event,
				event.name,
				JSON.stringify(event.data).slice(0, 200),
			);
		}
		const results = this._mapEvent(event);
		if (this.debug && results.length > 0) {
			console.debug(
				"[EventMapper] output:",
				results.map((e) => e.type),
			);
		}
		return results;
	}

	private _mapEvent(event: StreamEventInternal): BaseEvent[] {
		switch (event.event) {
			case "on_chat_model_stream":
				return this.handleChatModelStream(event);
			case "on_chat_model_end":
				return this.handleChatModelEnd();
			case "on_tool_end":
				return this.handleToolEnd(event);
			case "on_chain_start":
				return this.handleChainStart(event);
			case "on_chain_end":
				return this.handleChainEnd(event);
			default:
				return [];
		}
	}

	/**
	 * Emit closing events for any open text message, tool calls, or steps.
	 */
	finalize(): BaseEvent[] {
		const results: BaseEvent[] = [];

		if (this.hasEmittedTextStart && this.activeMessageId) {
			results.push({
				type: EventType.TEXT_MESSAGE_END,
				messageId: this.activeMessageId,
			} as BaseEvent);
		}

		for (const [toolCallId] of this.activeToolCalls) {
			results.push({
				type: EventType.TOOL_CALL_END,
				toolCallId,
			} as BaseEvent);
		}

		if (this.currentNode) {
			results.push({
				type: EventType.STEP_FINISHED,
				stepName: this.currentNode,
			} as BaseEvent);
		}

		return results;
	}

	// ── on_chat_model_stream ─────────────────────────────────

	private handleChatModelStream(event: StreamEventInternal): BaseEvent[] {
		const results: BaseEvent[] = [];
		const chunk = event.data?.chunk;
		if (!chunk) return results;

		// Text content — handle both string (OpenAI) and array (Anthropic) formats
		const rawContent = chunk.content;
		const content: string | undefined =
			typeof rawContent === "string"
				? rawContent
				: Array.isArray(rawContent)
					? rawContent
							.filter(
								(b: { type: string }) =>
									b && typeof b === "object" && b.type === "text",
							)
							.map((b: { text: string }) => b.text)
							.join("")
					: undefined;
		if (content && content.length > 0) {
			if (!this.hasEmittedTextStart) {
				this.activeMessageId = crypto.randomUUID();
				this.hasEmittedTextStart = true;
				results.push({
					type: EventType.TEXT_MESSAGE_START,
					messageId: this.activeMessageId,
					role: "assistant",
				} as BaseEvent);
			}
			results.push({
				type: EventType.TEXT_MESSAGE_CONTENT,
				messageId: this.activeMessageId as string,
				delta: content,
			} as BaseEvent);
		}

		// Tool call chunks
		const toolCallChunks = chunk.tool_call_chunks;
		if (toolCallChunks && Array.isArray(toolCallChunks)) {
			for (const tc of toolCallChunks) {
				const index: number = tc.index ?? 0;
				let toolCallId: string;
				if (tc.id) {
					toolCallId = tc.id;
					this.toolCallIndexToId.set(index, tc.id);
				} else {
					toolCallId = this.toolCallIndexToId.get(index) ?? `tool_${index}`;
				}

				if (tc.name && !this.activeToolCalls.has(toolCallId)) {
					// Close open text stream before starting a tool call
					if (this.hasEmittedTextStart && this.activeMessageId) {
						results.push({
							type: EventType.TEXT_MESSAGE_END,
							messageId: this.activeMessageId,
						} as BaseEvent);
						this.hasEmittedTextStart = false;
					}

					// Ensure a parent message exists so CopilotKit can attach the tool call
					if (!this.activeMessageId) {
						this.activeMessageId = crypto.randomUUID();
						results.push({
							type: EventType.TEXT_MESSAGE_START,
							messageId: this.activeMessageId,
							role: "assistant",
						} as BaseEvent);
						results.push({
							type: EventType.TEXT_MESSAGE_END,
							messageId: this.activeMessageId,
						} as BaseEvent);
					}

					this.activeToolCalls.set(toolCallId, true);
					this.pendingToolCallIds.push(toolCallId);
					results.push({
						type: EventType.TOOL_CALL_START,
						toolCallId,
						toolCallName: tc.name,
						parentMessageId: this.activeMessageId,
					} as BaseEvent);

					// Flush any args that arrived before the name
					const buffered = this.bufferedArgs.get(toolCallId);
					if (buffered) {
						results.push({
							type: EventType.TOOL_CALL_ARGS,
							toolCallId,
							delta: buffered,
						} as BaseEvent);
						this.bufferedArgs.delete(toolCallId);
					}
				}

				if (tc.args && tc.args.length > 0) {
					if (this.activeToolCalls.has(toolCallId)) {
						results.push({
							type: EventType.TOOL_CALL_ARGS,
							toolCallId,
							delta: tc.args,
						} as BaseEvent);
					} else {
						// Buffer args until TOOL_CALL_START fires
						const existing = this.bufferedArgs.get(toolCallId) ?? "";
						this.bufferedArgs.set(toolCallId, existing + tc.args);
					}
				}
			}
		}

		return results;
	}

	// ── on_chat_model_end ────────────────────────────────────

	private handleChatModelEnd(): BaseEvent[] {
		const results: BaseEvent[] = [];

		if (this.hasEmittedTextStart && this.activeMessageId) {
			results.push({
				type: EventType.TEXT_MESSAGE_END,
				messageId: this.activeMessageId,
			} as BaseEvent);
			this.hasEmittedTextStart = false;
		}

		for (const [toolCallId] of this.activeToolCalls) {
			results.push({
				type: EventType.TOOL_CALL_END,
				toolCallId,
			} as BaseEvent);
		}
		this.activeToolCalls.clear();
		this.toolCallIndexToId.clear();
		this.activeMessageId = null;

		return results;
	}

	// ── on_tool_end ──────────────────────────────────────────

	private handleToolEnd(event: StreamEventInternal): BaseEvent[] {
		const output = event.data?.output;
		if (!output) return [];

		let content: string;
		let rawToolCallId: string | undefined;

		if (typeof output === "string") {
			// Raw string return from tool
			content = output;
			rawToolCallId = undefined;
		} else if (output.lg_name === "Command") {
			// Command object from LangGraph tools (e.g. deepagents)
			const messages = output.update?.messages;
			if (Array.isArray(messages) && messages.length > 0) {
				const lastMsg = messages[messages.length - 1];
				content =
					typeof lastMsg.content === "string"
						? lastMsg.content
						: JSON.stringify(lastMsg.content);
				rawToolCallId = lastMsg.tool_call_id;
			} else {
				content = JSON.stringify(output.update ?? output);
			}
		} else {
			// ToolMessage object (standard case)
			content =
				typeof output.content === "string"
					? output.content
					: output.content != null
						? JSON.stringify(output.content)
						: "";
			rawToolCallId = output.tool_call_id;
		}

		// Resolve toolCallId: prefer matching a pending ID from TOOL_CALL_START,
		// fall back to queue order when IDs diverge (e.g. LangGraph-generated UUIDs).
		let toolCallId = rawToolCallId ?? event.run_id;
		const idx = this.pendingToolCallIds.indexOf(toolCallId);
		if (idx >= 0) {
			this.pendingToolCallIds.splice(idx, 1);
		} else if (this.pendingToolCallIds.length > 0) {
			toolCallId = this.pendingToolCallIds.shift() ?? toolCallId;
		}

		return [
			{
				type: EventType.TOOL_CALL_RESULT,
				messageId: `result-${toolCallId}`,
				toolCallId,
				content,
				role: "tool",
			} as BaseEvent,
		];
	}

	// ── on_chain_start / on_chain_end (step & state) ─────────

	private handleChainStart(event: StreamEventInternal): BaseEvent[] {
		const nodeName = event.metadata?.langgraph_node as string | undefined;
		if (!nodeName || event.name !== nodeName || SKIP_NODES.has(nodeName)) {
			return [];
		}

		// Nested chain within the same node — track depth, don't re-emit
		if (nodeName === this.currentNode) {
			this.stepDepth++;
			return [];
		}

		this.currentNode = nodeName;
		this.stepDepth = 1;
		return [
			{
				type: EventType.STEP_STARTED,
				stepName: nodeName,
			} as BaseEvent,
		];
	}

	private handleChainEnd(event: StreamEventInternal): BaseEvent[] {
		const nodeName = event.metadata?.langgraph_node as string | undefined;
		if (!nodeName || event.name !== nodeName || nodeName !== this.currentNode) {
			return [];
		}

		this.stepDepth--;

		// Inner chain closed — outer still running
		if (this.stepDepth > 0) {
			return [];
		}

		const results: BaseEvent[] = [];

		// Extract TOOL_CALL_RESULT from Command outputs (deepagents pattern:
		// on_chain_end emits an array of Commands instead of on_tool_end events)
		if (this.pendingToolCallIds.length > 0 && event.data?.output) {
			const outputs = Array.isArray(event.data.output)
				? event.data.output
				: [event.data.output];
			for (const cmd of outputs) {
				if (cmd?.lg_name !== "Command") continue;
				const msgs = cmd.update?.messages;
				if (!Array.isArray(msgs)) continue;
				for (const msg of msgs) {
					if (msg?.kwargs?.tool_call_id || msg?.tool_call_id) {
						const content =
							typeof (msg.kwargs?.content ?? msg.content) === "string"
								? (msg.kwargs?.content ?? msg.content)
								: JSON.stringify(msg.kwargs?.content ?? msg.content ?? "");
						const rawId = msg.kwargs?.tool_call_id ?? msg.tool_call_id;
						let toolCallId = rawId;
						const idx = this.pendingToolCallIds.indexOf(toolCallId);
						if (idx >= 0) {
							this.pendingToolCallIds.splice(idx, 1);
						} else if (this.pendingToolCallIds.length > 0) {
							toolCallId = this.pendingToolCallIds.shift() ?? toolCallId;
						}
						results.push({
							type: EventType.TOOL_CALL_RESULT,
							messageId: `result-${toolCallId}`,
							toolCallId,
							content,
							role: "tool",
						} as BaseEvent);
					}
				}
			}
		}

		// Emit STATE_SNAPSHOT if stateKeys are configured
		if (this.stateKeys.length > 0 && event.data?.output) {
			const snapshot = this.filterState(
				event.data.output as Record<string, unknown>,
			);
			if (Object.keys(snapshot).length > 0) {
				this.mergeState(snapshot);
				results.push({
					type: EventType.STATE_SNAPSHOT,
					snapshot: { ...this.accumulatedState },
				} as BaseEvent);
			}
		}

		results.push({
			type: EventType.STEP_FINISHED,
			stepName: nodeName,
		} as BaseEvent);
		this.currentNode = null;
		this.stepDepth = 0;

		return results;
	}

	// ── helpers ──────────────────────────────────────────────

	private filterState(
		output: Record<string, unknown>,
	): Record<string, unknown> {
		const filtered: Record<string, unknown> = {};
		for (const key of this.stateKeys) {
			if (key in output) {
				filtered[key] = output[key];
			}
		}
		return filtered;
	}

	private mergeState(update: Record<string, unknown>): void {
		for (const [key, value] of Object.entries(update)) {
			if (Array.isArray(value) && Array.isArray(this.accumulatedState[key])) {
				this.accumulatedState[key] = [
					...(this.accumulatedState[key] as unknown[]),
					...value,
				];
			} else {
				this.accumulatedState[key] = value;
			}
		}
	}
}
