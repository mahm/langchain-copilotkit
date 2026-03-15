"use client";

import { CopilotChat } from "@copilotkit/react-ui";
import { useCopilotChat } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
import { ToolCallRenderer } from "./components/ToolCallRenderer";
import { InterruptHandler } from "./components/InterruptHandler";

export default function Home() {
	const { isLoading } = useCopilotChat();

	return (
		<main className="flex h-screen flex-col bg-slate-50">
			<header className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
				<h1 className="text-base font-semibold text-slate-800 tracking-tight">
					LangChain CopilotKit Sample
				</h1>
				{isLoading && (
					<span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 border border-indigo-200">
						<span className="inline-block size-1.5 rounded-full bg-indigo-500 animate-pulse" />
						Processing
					</span>
				)}
			</header>
			<div className="flex-1 min-h-0 flex flex-col overflow-hidden">
				<ToolCallRenderer />
				<InterruptHandler />
				<CopilotChat
					labels={{
						title: "LangChain Agent",
						initial: "How can I help you?",
					}}
				/>
			</div>
		</main>
	);
}
