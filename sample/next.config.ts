import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	serverExternalPackages: [
		"deepagents",
		"@langchain/core",
		"@langchain/langgraph",
		"@langchain/anthropic",
		"langgraph-agui",
	],
};

export default nextConfig;
