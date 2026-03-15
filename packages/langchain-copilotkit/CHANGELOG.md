# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-03-15

### Added

- `LangChainAgentAdapter` — AG-UI agent backed by a LangChain Runnable for in-process CopilotKit integration
- `EventMapper` — maps LangChain stream events to AG-UI events (text, tool calls, steps, state snapshots)
- `convertMessages` / `convertToAgUiMessages` — bidirectional message conversion between AG-UI and LangChain formats
- HITL interrupt/resume support with `drainPendingToolCallIds()` for clean UI state on interrupt
- ESM and CJS dual-format distribution with full TypeScript type definitions
