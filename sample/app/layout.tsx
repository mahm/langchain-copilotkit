import type { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core";

export const metadata = {
	title: "LangGraph AG-UI Sample",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body>
				<CopilotKit runtimeUrl="/api/copilotkit">{children}</CopilotKit>
			</body>
		</html>
	);
}
