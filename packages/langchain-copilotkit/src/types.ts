/**
 * Structural type for any LangChain Runnable that supports streamEvents().
 * Using a structural type instead of importing Runnable avoids cross-package
 * version conflicts when @langchain/core is installed in multiple locations.
 */
export interface StreamableRunnable {
	// biome-ignore lint/suspicious/noExplicitAny: must accept any Runnable input/output shape for cross-package compatibility
	streamEvents(input: any, options: any): AsyncIterable<any>;
	// biome-ignore lint/suspicious/noExplicitAny: LangGraph state shape varies by graph
	getState?(config: any): Promise<any>;
}

export interface LangChainAgentAdapterOptions {
	agent: StreamableRunnable;
	stateKeys?: string[];
	/**
	 * When true (default), the adapter sends only new user messages on
	 * subsequent turns instead of the full CopilotKit history, preventing
	 * message duplication in checkpointer-backed graphs (MemorySaver, etc.).
	 * Set to false only for stateless runnables without a checkpointer.
	 */
	stateful?: boolean;
}
