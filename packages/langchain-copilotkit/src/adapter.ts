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
			const messages = convertMessages(input.messages);
			const eventStream = this.runnable.streamEvents(
				{ messages },
				{ version: "v2", configurable: { thread_id: input.threadId } },
			);

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

		subscriber.next({
			type: EventType.RUN_FINISHED,
			threadId: input.threadId,
			runId: input.runId,
		} as BaseEvent);

		subscriber.complete();
	}
}
