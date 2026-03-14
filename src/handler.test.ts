import { describe, expect, it } from "bun:test";
import { EventType } from "@ag-ui/client";
import { createAgUiHandler } from "./handler";

function makeMockAgent(events: Array<Record<string, unknown>>) {
	return {
		streamEvents: async function* (_input: unknown, _options: unknown) {
			for (const event of events) {
				yield event;
			}
		},
	} as never;
}

function makeRequest(body: Record<string, unknown>) {
	return new Request("http://localhost/ag-ui", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function readSSEEvents(response: Response) {
	const text = await response.text();
	return text
		.split("\n\n")
		.filter((line) => line.startsWith("data: "))
		.map((line) => JSON.parse(line.replace("data: ", "")));
}

const baseBody = {
	threadId: "t1",
	runId: "r1",
	messages: [],
	tools: [],
	context: [],
	state: {},
	forwardedProps: {},
};

describe("createAgUiHandler", () => {
	it("returns SSE response with correct headers", async () => {
		const handler = createAgUiHandler({ agent: makeMockAgent([]) });
		const response = await handler(makeRequest(baseBody));

		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Cache-Control")).toBe("no-cache");
	});

	it("emits RUN_STARTED and RUN_FINISHED events", async () => {
		const handler = createAgUiHandler({ agent: makeMockAgent([]) });
		const response = await handler(makeRequest(baseBody));
		const events = await readSSEEvents(response);

		expect(events[0].type).toBe(EventType.RUN_STARTED);
		expect(events[0].threadId).toBe("t1");
		expect(events[0].runId).toBe("r1");
		expect(events.at(-1).type).toBe(EventType.RUN_FINISHED);
	});

	it("streams text message events", async () => {
		const handler = createAgUiHandler({
			agent: makeMockAgent([
				{
					event: "on_chat_model_stream",
					name: "ChatAnthropic",
					data: { chunk: { content: "Hi" } },
					run_id: "r2",
					tags: [],
					metadata: {},
				},
				{
					event: "on_chat_model_end",
					name: "ChatAnthropic",
					data: {},
					run_id: "r2",
					tags: [],
					metadata: {},
				},
			]),
		});

		const response = await handler(makeRequest(baseBody));
		const events = await readSSEEvents(response);
		const types = events.map((e: { type: string }) => e.type);

		expect(types).toContain(EventType.TEXT_MESSAGE_START);
		expect(types).toContain(EventType.TEXT_MESSAGE_CONTENT);
		expect(types).toContain(EventType.TEXT_MESSAGE_END);
	});

	it("emits RUN_ERROR on stream failure", async () => {
		const failingAgent = {
			streamEvents: () => ({
				[Symbol.asyncIterator]: () => ({
					next: () => Promise.reject(new Error("handler error")),
				}),
			}),
		} as never;

		const handler = createAgUiHandler({ agent: failingAgent });
		const response = await handler(makeRequest(baseBody));
		const events = await readSSEEvents(response);

		const errorEvent = events.find(
			(e: { type: string }) => e.type === EventType.RUN_ERROR,
		);
		expect(errorEvent).toBeDefined();
		expect(errorEvent.message).toBe("handler error");
	});
});
