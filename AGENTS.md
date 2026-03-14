# Agent Guidelines

<!-- Do not restructure or delete sections. Update individual values in-place when they change. -->

## Core Principles

- Always prefer simplicity over pathological correctness. YAGNI, KISS, DRY. No backward-compat shims or fallback paths unless they come free without adding cyclomatic complexity.
- Keep AGENTS.md in English. AGENTS.md must not exceed 150 lines.
- If an issue occurs, do not address it with a quick patch. Investigate the root cause thoroughly and implement a fundamental fix.
- Even if you discover a defect that is not directly related to this task, you must still create a remediation plan and resolve it at the root level to ensure the overall quality of the software.
- When making any additions or modifications to applications under `sample/`, you must always verify and test all behavior in the browser.

## Maintenance Notes

<!-- This section is permanent. Do not delete. -->

**Keep this file lean and current:**

1. **Remove placeholder sections** (sections still containing `[To be determined]` or `[Add your ... here]`) once you fill them in
2. **Review regularly** - stale instructions poison the agent's context
3. **CRITICAL: Keep total under 20-30 lines** - move detailed docs to separate files and reference them
4. **Update commands immediately** when workflows change
5. **Rewrite Architecture section** when major architectural changes occur
6. **Delete anything the agent can infer** from your code
