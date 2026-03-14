import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { EventEncoder } from "@ag-ui/encoder";
import { convertMessages } from "./adapter";
import { EventMapper } from "./event_mapper";
import type { LangGraphAgentOptions } from "./types";

/**
 * Create a standalone HTTP handler that speaks the AG-UI SSE protocol.
 *
 * Works with any runtime that supports the Web `Request`/`Response` API
 * (Bun.serve, Deno.serve, Cloudflare Workers, Express via adapter, etc.).
 *
 * ```ts
 * const handler = createAgUiHandler({ agent: compiledGraph });
 *
 * // Bun
 * Bun.serve({ port: 3000, fetch: handler });
 *
 * // Express (via adapter)
 * app.post("/ag-ui", async (req, res) => {
 *   const response = await handler(req);
 *   // pipe response back
 * });
 * ```
 */
export function createAgUiHandler(options: LangGraphAgentOptions) {
	const encoder = new EventEncoder();
	const textEncoder = new TextEncoder();

	return async (request: Request): Promise<Response> => {
		const input = (await request.json()) as RunAgentInput;

		const stream = new ReadableStream({
			async start(controller) {
				const mapper = new EventMapper(options.stateKeys);

				const emit = (event: BaseEvent) => {
					controller.enqueue(textEncoder.encode(encoder.encode(event)));
				};

				try {
					emit({
						type: EventType.RUN_STARTED,
						threadId: input.threadId,
						runId: input.runId,
					} as BaseEvent);

					const messages = convertMessages(input.messages);
					const eventStream = options.agent.streamEvents(
						{ messages },
						{ version: "v2" },
					);

					for await (const event of eventStream) {
						for (const e of mapper.mapEvent(event)) {
							emit(e);
						}
					}

					for (const e of mapper.finalize()) {
						emit(e);
					}

					emit({
						type: EventType.RUN_FINISHED,
						threadId: input.threadId,
						runId: input.runId,
					} as BaseEvent);
				} catch (error) {
					emit({
						type: EventType.RUN_ERROR,
						message: error instanceof Error ? error.message : String(error),
					} as BaseEvent);
				} finally {
					controller.close();
				}
			},
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	};
}
