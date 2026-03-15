import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
	AgentConfig,
	BaseEvent,
	Message,
	RunAgentInput,
} from "@ag-ui/client";
import { Observable, type Subscriber } from "rxjs";
import { EventMapper } from "./event_mapper";
import { convertMessages } from "./messages";
import type { LangChainAgentAdapterOptions, StreamableRunnable } from "./types";

/**
 * AG-UI agent backed by a LangChain Runnable.
 *
 * Designed for **in-process** integration with CopilotKit — no separate
 * HTTP server or `langgraph up` process required.
 *
 * ```ts
 * const runtime = new CopilotRuntime({
 *   agents: [new LangChainAgentAdapter({ agent: compiledGraph })],
 * });
 * ```
 */
export class LangChainAgentAdapter extends AbstractAgent {
	private runnable: StreamableRunnable;
	private stateKeys: string[];
	private stateful: boolean;

	constructor(options: LangChainAgentAdapterOptions & Partial<AgentConfig>) {
		const { agent, stateKeys, stateful, ...agentConfig } = options;
		super({ description: "LangChain Agent", ...agentConfig });
		this.runnable = agent;
		this.stateKeys = stateKeys ?? [];
		this.stateful = stateful ?? true;
	}

	clone(): LangChainAgentAdapter {
		const cloned = super.clone() as LangChainAgentAdapter;
		cloned.runnable = this.runnable;
		cloned.stateKeys = [...this.stateKeys];
		cloned.stateful = this.stateful;
		return cloned;
	}

	/**
	 * In stateful mode, only send new messages to the graph.
	 * The checkpoint already holds the full history from prior turns.
	 */
	private filterInputMessages(messages: Message[]): Message[] {
		if (!this.stateful) return messages;

		// First turn: no assistant message yet — send all to initialize checkpoint
		if (!messages.some((m) => m.role === "assistant")) return messages;

		// Subsequent turn: only new user messages after the last assistant/tool
		let lastIdx = -1;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "assistant" || messages[i].role === "tool") {
				lastIdx = i;
				break;
			}
		}
		return messages.slice(lastIdx + 1);
	}

	run(input: RunAgentInput): Observable<BaseEvent> {
		return new Observable<BaseEvent>((subscriber) => {
			let aborted = false;

			this.runStream(input, subscriber, () => aborted).catch((err) => {
				if (!aborted) {
					subscriber.next({
						type: EventType.RUN_ERROR,
						message: err instanceof Error ? err.message : String(err),
					} as BaseEvent);
					subscriber.complete();
				}
			});

			return () => {
				aborted = true;
			};
		});
	}

	private async runStream(
		input: RunAgentInput,
		subscriber: Subscriber<BaseEvent>,
		isAborted: () => boolean,
	): Promise<void> {
		const mapper = new EventMapper(this.stateKeys);

		subscriber.next({
			type: EventType.RUN_STARTED,
			threadId: input.threadId,
			runId: input.runId,
		} as BaseEvent);

		try {
			// Resume detection: if forwardedProps.command.resume is present,
			// use Command({ resume }) as input instead of messages
			const resumeValue = (
				input.forwardedProps as Record<string, unknown> | undefined
			)?.command;
			let streamInput: unknown;
			if (
				resumeValue &&
				typeof resumeValue === "object" &&
				"resume" in resumeValue
			) {
				const { Command } = await import("@langchain/langgraph");
				let rawResume = (resumeValue as { resume: unknown }).resume;
				// Parse JSON string resume values so the graph receives an object
				if (typeof rawResume === "string") {
					try {
						rawResume = JSON.parse(rawResume);
					} catch {
						// keep as string if not valid JSON
					}
				}
				streamInput = new Command({ resume: rawResume });
			} else {
				const filtered = this.filterInputMessages(input.messages);
				const messages = convertMessages(filtered);
				streamInput = { messages };
			}

			const eventStream = this.runnable.streamEvents(streamInput, {
				version: "v2",
				configurable: { thread_id: input.threadId },
			});

			for await (const event of eventStream) {
				if (isAborted()) return;

				const agUiEvents = mapper.mapEvent(event);
				for (const e of agUiEvents) {
					subscriber.next(e);
				}
			}
		} catch (error) {
			// Finalize open events before propagating the error
			for (const e of mapper.finalize()) {
				subscriber.next(e);
			}
			throw error;
		}

		// Flush any remaining open events
		for (const e of mapper.finalize()) {
			subscriber.next(e);
		}

		// Interrupt detection: check graph state for pending interrupts
		if (this.runnable.getState) {
			try {
				const state = await this.runnable.getState({
					configurable: { thread_id: input.threadId },
				});
				const interrupts = (state?.tasks ?? []).flatMap(
					(t: { interrupts?: { value?: unknown }[] }) => t.interrupts ?? [],
				);
				if (interrupts.length > 0) {
					// Emit TOOL_CALL_RESULT for pending tool calls so the UI
					// transitions from "executing" (spinner) to "complete".
					for (const toolCallId of mapper.drainPendingToolCallIds()) {
						subscriber.next({
							type: EventType.TOOL_CALL_RESULT,
							messageId: `result-${toolCallId}`,
							toolCallId,
							content: "Awaiting approval",
							role: "tool",
						} as BaseEvent);
					}

					subscriber.next({
						type: EventType.CUSTOM,
						name: "on_interrupt",
						value: JSON.stringify(interrupts[0].value),
					} as BaseEvent);
				}
			} catch {
				// getState failure should not block the run
			}
		}

		subscriber.next({
			type: EventType.RUN_FINISHED,
			threadId: input.threadId,
			runId: input.runId,
		} as BaseEvent);

		subscriber.complete();
	}
}
