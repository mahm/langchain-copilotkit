# Test Design — langchain-copilotkit

Communication scenarios between langchain-copilotkit and CopilotKit via the AG-UI protocol.

Reference: [CopilotKit LangChainAdapter](https://github.com/CopilotKit/CopilotKit) patterns considered.

## 1. EventMapper (`event_mapper.test.ts`)

### 1.1 Text Message Streaming

| # | Scenario | Input | Expected Output |
|---|----------|-------|-----------------|
| T1 | First text chunk | `on_chat_model_stream` content="Hello" | TEXT_MESSAGE_START + TEXT_MESSAGE_CONTENT |
| T2 | Subsequent text chunk | second `on_chat_model_stream` | TEXT_MESSAGE_CONTENT only |
| T3 | Empty content chunk | content="" | No events (skip) |
| T4 | Chat model end | `on_chat_model_end` | TEXT_MESSAGE_END |
| T5 | Anthropic array content | content=[{type:"text",text:"Hello"}] | TEXT_MESSAGE_START + TEXT_MESSAGE_CONTENT |
| T6 | Non-text blocks only | content=[{type:"tool_use",...}] | No events |
| T7 | Missing chunk (data.chunk=undefined) | `on_chat_model_stream` without chunk | No events |

### 1.2 Tool Call Streaming

| # | Scenario | Input | Expected Output |
|---|----------|-------|-----------------|
| TC1 | Tool call start (no prior text) | tool_call_chunks with name | Synthetic parent (START+END) + TOOL_CALL_START + TOOL_CALL_ARGS |
| TC2 | Text → tool call transition | text chunk then tool chunk | TEXT_MESSAGE_END before TOOL_CALL_START |
| TC3 | Tool call end | `on_chat_model_end` after tool call | TOOL_CALL_END |
| TC4 | Tool result (ToolMessage) | `on_tool_end` with ToolMessage output | TOOL_CALL_RESULT with content + toolCallId |
| TC5 | Tool call ID mismatch | streaming id="toolu_AAA", result id="uuid" | TOOL_CALL_RESULT uses streaming id via pending queue |
| TC6 | Multi-chunk tool call (id=null) | subsequent chunks with id=null, same index | TOOL_CALL_ARGS with resolved id from index map |
| TC7 | Parallel tool calls | two tool_call_chunks with index 0 and 1 | Separate TOOL_CALL_START for each, correct id mapping |
| TC8 | Buffered args (args before name) | args chunk without name, then name chunk | Buffer flushed after TOOL_CALL_START |
| TC9 | Command object in on_tool_end | output.lg_name="Command" with update.messages | TOOL_CALL_RESULT extracted from Command |
| TC10 | Raw string tool output | output="plain text" | TOOL_CALL_RESULT with string content |
| TC11 | Non-string ToolMessage content | output.content={key:"value"} | TOOL_CALL_RESULT with JSON.stringify'd content |
| TC12 | Command with empty messages | output.lg_name="Command", update.messages=[] | TOOL_CALL_RESULT with serialized update |
| TC13 | on_tool_end with no output | data.output=undefined | No events (empty array) |
| TC14 | Parallel tool call RESULT ordering | two pending IDs, results arrive in order | Each TOOL_CALL_RESULT matches correct pending ID |
| TC15 | Same tool called multiple times | same name, different index/id | Each call tracked separately by index |

### 1.3 Step Tracking

| # | Scenario | Input | Expected Output |
|---|----------|-------|-----------------|
| S1 | Node chain start | `on_chain_start` name=langgraph_node="agent" | STEP_STARTED |
| S2 | Node chain end | `on_chain_end` after start | STEP_FINISHED |
| S3 | Skip __start__/__end__ | langgraph_node="__start__" | No events |
| S4 | Nested chains (depth tracking) | same node name nested start/end | Only outer emits STEP_STARTED/FINISHED |
| S5 | Inner chain ignored (name≠node) | name="RunnableSequence", node="agent" | No events |
| S6 | Node transition (auto close) | agent→tools without agent end | STEP_FINISHED(agent) + STEP_STARTED(tools) |
| S7 | Subgraph execution | parent node→child graph nodes→return | Correct step transitions across graph boundary |

### 1.4 State Snapshot

| # | Scenario | Input | Expected Output |
|---|----------|-------|-----------------|
| SS1 | Matching stateKeys | on_chain_end output has matching keys | STATE_SNAPSHOT with filtered state |
| SS2 | No matching keys | output has no matching keys | Only STEP_FINISHED (no snapshot) |
| SS3 | Accumulated state merge (multi-step) | two steps with different keys | Merged STATE_SNAPSHOT |
| SS4 | Array concatenation merge | both steps have same array key | Arrays concatenated in snapshot |

### 1.5 Command in on_chain_end (deepagents)

| # | Scenario | Input | Expected Output |
|---|----------|-------|-----------------|
| DC1 | Command array with ToolMessages | output=[{lg_name:"Command",...}] | TOOL_CALL_RESULT for each message |
| DC2 | kwargs-style ToolMessage | msg.kwargs.tool_call_id + msg.kwargs.content | Correctly extracted TOOL_CALL_RESULT |

### 1.6 Finalize

| # | Scenario | State Before | Expected Output |
|---|----------|-------------|-----------------|
| F1 | Open text + step | text streaming, step active | TEXT_MESSAGE_END + STEP_FINISHED |
| F2 | Open tool calls | active tool calls | TOOL_CALL_END for each |
| F3 | Nothing open | clean state | Empty array |

### 1.7 Utility Methods

| # | Scenario | Input | Expected Output |
|---|----------|-------|-----------------|
| U1 | drainPendingToolCallIds | pending IDs exist | Returns IDs array, clears internal queue |
| U2 | Buffered args not leaked | finalize after buffered args | No memory leak (bufferedArgs cleared) |

## 2. Adapter (`adapter.test.ts`)

### 2.1 Run Lifecycle

| # | Scenario | Setup | Expected |
|---|----------|-------|----------|
| A1 | Empty stream | no events | RUN_STARTED + RUN_FINISHED |
| A2 | Text streaming E2E | text chunks | Full text event sequence |
| A3 | Tool call E2E | tool call + result | Full tool call event sequence |
| A4 | Stream error | streamEvents throws | RUN_ERROR with message |
| A5 | Error with open events | error mid-stream with open text/step | finalize() events before RUN_ERROR |
| A6 | Observable unsubscribe | unsubscribe during stream | Stream aborted, no further events |

### 2.2 Clone

| # | Scenario | Setup | Expected |
|---|----------|-------|----------|
| CL1 | Preserve runnable/stateKeys | clone() | Same agent, stateKeys, produces events |
| CL2 | Preserve stateful flag | clone() with stateful:true | Filters messages correctly |

### 2.3 Interrupt Detection

| # | Scenario | Setup | Expected |
|---|----------|-------|----------|
| I1 | getState returns interrupts | tasks[0].interrupts present | CUSTOM "on_interrupt" event |
| I2 | Pending tool calls on interrupt | tool call started, then interrupt | TOOL_CALL_RESULT("Awaiting approval") for each pending |
| I3 | getState() throws | getState rejects | Silent catch, RUN_FINISHED still emitted |
| I4 | No getState method | agent without getState | Skip interrupt check, RUN_FINISHED |
| I5 | Empty interrupts array | tasks[0].interrupts=[] | No CUSTOM event |

### 2.4 Resume

| # | Scenario | Setup | Expected |
|---|----------|-------|----------|
| R1 | Command from forwardedProps | command.resume present | Command object passed to streamEvents |
| R2 | JSON string resume parsed | resume='{"decisions":[...]}' | Parsed object in Command |
| R3 | Invalid JSON kept as string | resume='not json' | String kept as-is in Command |

### 2.5 Stateful Mode

| # | Scenario | Setup | Expected |
|---|----------|-------|----------|
| SM1 | First turn (no assistant) | stateful:true, only user msgs | All messages sent |
| SM2 | Subsequent turn | stateful:true, user+assistant+user | Only new user message(s) sent |
| SM3 | Default (stateful:false) | no stateful flag | All messages sent |
| SM4 | Resume bypasses filter | stateful:true + command.resume | Command used, not messages |
| SM5 | No new user after assistant | stateful:true, ends with assistant | Empty messages sent |
| SM6 | Tool role as last message | stateful:true, ends with tool msg | Messages after tool sent |

### 2.6 Configuration

| # | Scenario | Setup | Expected |
|---|----------|-------|----------|
| CF1 | thread_id in configurable | any input with threadId | configurable.thread_id matches input.threadId |

## 3. Message Conversion (`messages.test.ts`)

### 3.1 AG-UI → LangChain

| # | Scenario | Input | Expected Output |
|---|----------|-------|-----------------|
| M1 | user → HumanMessage | role:"user" | HumanMessage with content, id |
| M2 | assistant → AIMessage | role:"assistant" | AIMessage with content |
| M3 | assistant + toolCalls | toolCalls array | AIMessage with tool_calls |
| M4 | system → SystemMessage | role:"system" | SystemMessage |
| M5 | developer → SystemMessage | role:"developer" | SystemMessage |
| M6 | tool → ToolMessage | role:"tool" | ToolMessage with tool_call_id |
| M7 | activity/reasoning → null | role:"activity" | Filtered out (empty array) |
| M8 | Non-string content | content:{key:"value"} | JSON.stringify'd content |
| M9 | Invalid JSON in tool args | arguments:"not json" | safeParseJson → {raw:"not json"} |
| M10 | Unknown role fallback | role:"custom" | HumanMessage with stringified message |

### 3.2 LangChain → AG-UI

| # | Scenario | Input | Expected Output |
|---|----------|-------|-----------------|
| M11 | HumanMessage → user | HumanMessage | role:"user" |
| M12 | AIMessage → assistant | AIMessage | role:"assistant" |
| M13 | AIMessage + tool_calls | tool_calls array | toolCalls with JSON-stringified args |
| M14 | SystemMessage → system | SystemMessage | role:"system" |
| M15 | ToolMessage → tool | ToolMessage | role:"tool", toolCallId |
| M16 | Missing ID → UUID | message without id | Generated UUID as id |
| M17 | Non-string content | content:[{type:"text"}] | JSON.stringify'd content |
| M18 | Empty tool_calls array | tool_calls=[] | No toolCalls field (undefined) |
| M19 | Unknown type fallback | custom message type | role:"user" |

## 4. CopilotKit Integration (`integration.test.ts`)

### 4.1 verifyEvents Validation

| # | Scenario | Event Source | Expected |
|---|----------|-------------|----------|
| V1 | Text-only | textOnlyScenario | Pass verification |
| V2 | ReAct tool call | toolCallReActScenario | Pass verification |
| V3 | deepagents Command | deepagentsCommandScenario | Pass verification |
| V4 | Text then tool | textThenToolScenario | Pass verification |

### 4.2 defaultApplyEvents Message Building

| # | Scenario | Event Source | Expected Messages |
|---|----------|-------------|-------------------|
| DA1 | Text-only | textOnlyScenario | assistant message with content |
| DA2 | ReAct | toolCallReActScenario | assistant+toolCalls, tool result, final text |
| DA3 | deepagents | deepagentsCommandScenario | tool result, final text |
| DA4 | Text+tool parentMessageId | textThenToolScenario | toolCalls linked to text message |
| DA5 | TOOL_CALL_START has parentMessageId | all tool scenarios | Valid parentMessageId on every TOOL_CALL_START |
| DA6 | TEXT_MESSAGE_START precedes TOOL_CALL_START | all tool scenarios | Matching messageId seen before parentMessageId |

### 4.3 Multi-turn & Stateful

| # | Scenario | Setup | Expected |
|---|----------|-------|----------|
| MT1 | Tool messages preserved | toolCallReActScenario → messages | tool role messages in output |
| MT2 | Stateful filter on round-trip | turn1 messages + new user | Only new user message after filter |

### 4.4 Advanced Scenarios

| # | Scenario | Setup | Expected |
|---|----------|-------|----------|
| AS1 | STATE_SNAPSHOT in event stream | stateKeys + node end with output | verifyEvents passes, state reflected |
| AS2 | Interrupt → resume flow | interrupt event + Command resume | Event sequence valid for both phases |
| AS3 | Same tool multiple calls | two calls to same tool, different args | Results mapped to correct tool call IDs |
| AS4 | Message round-trip ID consistency | AG-UI → LangChain → AG-UI | IDs preserved through conversion |
| AS5 | Subgraph step transitions | parent→child graph nodes | Step events valid, verifyEvents passes |

## 5. Browser E2E (sample app, via agent-browser)

| # | Scenario | Verification |
|---|----------|-------------|
| E1 | Text-only conversation | Streaming display, message completes |
| E2 | Single tool call | Spinner → result → text response |
| E3 | Parallel tool calls | Multiple tools display and complete |
| E4 | Interrupt (Approve) | Approval UI → approve → continue |
| E5 | Interrupt (Reject + message) | Reject + feedback → AI regenerates |
| E6 | Multi-turn conversation | State preserved across turns |
| E7 | Error display | RUN_ERROR shown in UI |
