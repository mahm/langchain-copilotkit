/**
 * Structural type for any LangChain Runnable that supports streamEvents().
 * Using a structural type instead of importing Runnable avoids cross-package
 * version conflicts when @langchain/core is installed in multiple locations.
 */
export interface StreamableRunnable {
	// biome-ignore lint/suspicious/noExplicitAny: must accept any Runnable input/output shape for cross-package compatibility
	streamEvents(input: any, options: any): AsyncIterable<any>;
}

export interface LangChainAgentAdapterOptions {
	agent: StreamableRunnable;
	stateKeys?: string[];
}
