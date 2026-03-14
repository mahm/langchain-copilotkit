import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	serverExternalPackages: [
		"deepagents",
		"@langchain/core",
		"@langchain/langgraph",
		"@langchain/anthropic",
		"langchain-copilotkit",
	],
};

export default nextConfig;
