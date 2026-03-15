"use client";

import type { CatchAllActionRenderProps } from "@copilotkit/react-core";
import { useDefaultTool } from "@copilotkit/react-core";

function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={`inline-block size-3 rounded-full border-2 border-current border-t-transparent animate-spin ${className ?? ""}`}
    />
  );
}

export function ToolCallRenderer() {
  useDefaultTool(
    {
      render: (props: CatchAllActionRenderProps) => {
        const { status, name, args } = props;

        if (status === "inProgress") {
          return (
            <div className="my-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 font-mono text-[13px]">
              <div className="flex items-center gap-1.5">
                <Spinner className="text-indigo-500" />
                <strong className="text-indigo-900">{name}</strong>
              </div>
              {Object.keys(args).length > 0 && (
                <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-slate-500">
                  {JSON.stringify(args, null, 2)}
                </pre>
              )}
            </div>
          );
        }

        if (status === "executing") {
          return (
            <div className="my-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-mono text-[13px]">
              <div className="flex items-center gap-1.5">
                <Spinner className="text-amber-500" />
                <strong className="text-amber-900">{name}</strong>
                <span className="text-amber-600 text-xs">executing</span>
              </div>
              <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-slate-500">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          );
        }

        // Complete state
        const hasResult =
          props.result !== undefined &&
          props.result !== null &&
          props.result !== "";
        const resultStr = hasResult
          ? JSON.stringify(props.result, null, 2)
          : null;
        const isLong = resultStr != null && resultStr.length > 200;

        return (
          <div className="my-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-mono text-[13px]">
            <div className="flex items-center gap-1.5">
              <svg
                className="size-3.5 text-emerald-600"
                viewBox="0 0 16 16"
                fill="currentColor"
                role="img"
                aria-label="Complete"
              >
                <path
                  fillRule="evenodd"
                  d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm3.28-8.72a.75.75 0 0 0-1.06-1.06L7 8.44 5.78 7.22a.75.75 0 0 0-1.06 1.06l1.75 1.75a.75.75 0 0 0 1.06 0l3.75-3.75Z"
                  clipRule="evenodd"
                />
              </svg>
              <strong className="text-emerald-900">{name}</strong>
            </div>
            {isLong ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-700">
                  Show result
                </summary>
                <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-slate-700">
                  {resultStr}
                </pre>
              </details>
            ) : resultStr ? (
              <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-slate-700">
                {resultStr}
              </pre>
            ) : null}
          </div>
        );
      },
    },
    [],
  );

  return null;
}
