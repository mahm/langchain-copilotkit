import { AbstractAgent, EventType } from "@ag-ui/client";
import type { AgentConfig, BaseEvent, RunAgentInput } from "@ag-ui/client";
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

	constructor(options: LangChainAgentAdapterOptions & Partial<AgentConfig>) {
		const { agent, stateKeys, ...agentConfig } = options;
		super({ description: "LangChain Agent", ...agentConfig });
		this.runnable = agent;
		this.stateKeys = stateKeys ?? [];
	}

	clone(): LangChainAgentAdapter {
		const cloned = super.clone() as LangChainAgentAdapter;
		cloned.runnable = this.runnable;
		cloned.stateKeys = [...this.stateKeys];
		return cloned;
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
				const messages = convertMessages(input.messages);
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
					(t: { interrupts?: { value?: unknown }[] }) =>
						t.interrupts ?? [],
				);
				if (interrupts.length > 0) {
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
