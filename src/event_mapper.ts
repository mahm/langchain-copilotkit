import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";

const SKIP_NODES = new Set(["__start__", "__end__"]);

// Internal type for accessing LangGraph stream event fields
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
 * Maps LangGraph stream events to AG-UI BaseEvent arrays.
 *
 * Handles: TEXT_MESSAGE, TOOL_CALL, TOOL_CALL_RESULT, STATE_SNAPSHOT, STEP
 */
export class EventMapper {
	private stateKeys: string[];
	private activeMessageId: string | null = null;
	private activeToolCalls = new Map<string, boolean>();
	private hasEmittedTextStart = false;
	private currentNode: string | null = null;
	private accumulatedState: Record<string, unknown> = {};
	private toolCallIndexToId = new Map<number, string>();

	constructor(stateKeys: string[] = []) {
		this.stateKeys = stateKeys;
	}

	mapEvent(rawEvent: Record<string, unknown>): BaseEvent[] {
		const event = rawEvent as unknown as StreamEventInternal;
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

					this.activeToolCalls.set(toolCallId, true);
					results.push({
						type: EventType.TOOL_CALL_START,
						toolCallId,
						toolCallName: tc.name,
						parentMessageId: this.activeMessageId,
					} as BaseEvent);
				}

				if (tc.args && tc.args.length > 0) {
					results.push({
						type: EventType.TOOL_CALL_ARGS,
						toolCallId,
						delta: tc.args,
					} as BaseEvent);
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

		const content =
			typeof output.content === "string"
				? output.content
				: JSON.stringify(output.content);
		const toolCallId = output.tool_call_id ?? event.run_id;

		return [
			{
				type: EventType.TOOL_CALL_RESULT,
				messageId: output.id ?? crypto.randomUUID(),
				toolCallId,
				content,
				role: "tool",
			} as BaseEvent,
		];
	}

	// ── on_chain_start / on_chain_end (step & state) ─────────

	private handleChainStart(event: StreamEventInternal): BaseEvent[] {
		const nodeName = event.metadata?.langgraph_node as string | undefined;

		if (
			nodeName &&
			event.name === nodeName &&
			!SKIP_NODES.has(nodeName) &&
			nodeName !== this.currentNode
		) {
			this.currentNode = nodeName;
			return [
				{
					type: EventType.STEP_STARTED,
					stepName: nodeName,
				} as BaseEvent,
			];
		}
		return [];
	}

	private handleChainEnd(event: StreamEventInternal): BaseEvent[] {
		const results: BaseEvent[] = [];
		const nodeName = event.metadata?.langgraph_node as string | undefined;

		if (nodeName && event.name === nodeName && nodeName === this.currentNode) {
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
		}

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
