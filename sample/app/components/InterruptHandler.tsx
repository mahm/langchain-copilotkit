"use client";

import { useLangGraphInterrupt } from "@copilotkit/react-core";
import { useRef, useState } from "react";

function InterruptCard({
  action,
  args,
  resolve,
}: {
  action: string;
  args: Record<string, unknown>;
  resolve: (resolution: string) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const composingRef = useRef(false);

  const sendFeedback = () => {
    if (!feedback.trim()) return;
    resolve(
      JSON.stringify({
        decisions: [{ type: "reject", message: feedback.trim() }],
      }),
    );
  };

  return (
    <div className="my-2 rounded-lg border border-orange-300 bg-orange-50 p-4 font-sans text-sm shadow-sm">
      <div className="mb-2 font-semibold text-orange-900">
        Approval Required: {action}
      </div>
      <pre className="mb-3 whitespace-pre-wrap break-all rounded bg-white/60 p-2 text-xs text-slate-700">
        {JSON.stringify(args, null, 2)}
      </pre>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition-colors"
          onClick={() =>
            resolve(
              JSON.stringify({
                decisions: [{ type: "approve" }],
              }),
            )
          }
        >
          Allow
        </button>
        <button
          type="button"
          className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors"
          onClick={() =>
            resolve(
              JSON.stringify({
                decisions: [{ type: "reject" }],
              }),
            )
          }
        >
          Deny
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          className="flex-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
          placeholder="修正の指示を入力してEnterで送信..."
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !composingRef.current) {
              sendFeedback();
            }
          }}
        />
        <button
          type="button"
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          disabled={!feedback.trim()}
          onClick={sendFeedback}
        >
          Send
        </button>
      </div>
    </div>
  );
}

export function InterruptHandler() {
  useLangGraphInterrupt({
    render: ({ event, resolve }) => {
      let parsed: Record<string, unknown> = {};
      try {
        const raw = event.value;
        parsed = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
      } catch {
        parsed = { raw: event.value };
      }

      const action =
        (parsed.action as string) ??
        (parsed.actionRequests as { name: string }[])?.[0]?.name ??
        "Unknown action";
      const args =
        (parsed.args as Record<string, unknown>) ??
        (
          parsed.actionRequests as {
            args: Record<string, unknown>;
          }[]
        )?.[0]?.args ??
        parsed;

      return <InterruptCard action={action} args={args} resolve={resolve} />;
    },
  });

  return null;
}
