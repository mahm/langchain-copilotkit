"use client";

import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

export default function Home() {
	return (
		<main style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
			<h1 style={{ padding: "1rem", margin: 0, borderBottom: "1px solid #eee" }}>
				LangGraph AG-UI Sample
			</h1>
			<div style={{ flex: 1 }}>
				<CopilotChat
					labels={{
						title: "LangGraph Agent",
						initial: "How can I help you?",
					}}
				/>
			</div>
		</main>
	);
}
