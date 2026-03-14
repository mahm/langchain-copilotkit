import { AbstractAgent, EventType } from "@ag-ui/client";
import type { AgentConfig, BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable, type Subscriber } from "rxjs";
import { convertMessages } from "./adapter";
import { EventMapper } from "./event_mapper";
import type { LangGraphAgentOptions, StreamableRunnable } from "./types";

/**
 * AG-UI agent backed by a LangGraph Runnable.
 *
 * Designed for **in-process** integration with CopilotKit — no separate
 * HTTP server or `langgraph dev` process required.
 *
 * ```ts
 * const runtime = new CopilotRuntime({
 *   agents: [new LangGraphAgent({ agent: compiledGraph })],
 * });
 * ```
 */
export class LangGraphAgent extends AbstractAgent {
	private langGraphAgent: StreamableRunnable;
	private stateKeys: string[];

	constructor(options: LangGraphAgentOptions & Partial<AgentConfig>) {
		const { agent, stateKeys, ...agentConfig } = options;
		super({ description: "LangGraph Agent", ...agentConfig });
		this.langGraphAgent = agent;
		this.stateKeys = stateKeys ?? [];
	}

	clone(): LangGraphAgent {
		const cloned = super.clone() as LangGraphAgent;
		cloned.langGraphAgent = this.langGraphAgent;
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

		const messages = convertMessages(input.messages);
		const eventStream = this.langGraphAgent.streamEvents(
			{ messages },
			{ version: "v2" },
		);

		for await (const event of eventStream) {
			if (isAborted()) return;

			const agUiEvents = mapper.mapEvent(event);
			for (const e of agUiEvents) {
				subscriber.next(e);
			}
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
