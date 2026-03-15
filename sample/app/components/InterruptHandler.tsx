"use client";

import { useLangGraphInterrupt } from "@copilotkit/react-core";
import { useState } from "react";

function InterruptCard({
	action,
	args,
	resolve,
}: {
	action: string;
	args: Record<string, unknown>;
	resolve: (resolution: string) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [editText, setEditText] = useState("");
	const [editError, setEditError] = useState<string | null>(null);

	const startEditing = () => {
		setEditText(JSON.stringify(args, null, 2));
		setEditError(null);
		setEditing(true);
	};

	const submitEdit = () => {
		try {
			const editedArgs = JSON.parse(editText);
			setEditing(false);
			resolve(
				JSON.stringify({
					decisions: [
						{
							type: "edit",
							editedAction: { name: action, args: editedArgs },
						},
					],
				}),
			);
		} catch {
			setEditError("Invalid JSON");
		}
	};

	return (
		<div className="my-2 rounded-lg border border-orange-300 bg-orange-50 p-4 font-sans text-sm shadow-sm">
			<div className="mb-2 font-semibold text-orange-900">
				Approval Required: {action}
			</div>
			{!editing && (
				<pre className="mb-3 whitespace-pre-wrap break-all rounded bg-white/60 p-2 text-xs text-slate-700">
					{JSON.stringify(args, null, 2)}
				</pre>
			)}
			{editing ? (
				<div className="mt-2">
					<textarea
						className="w-full rounded border border-slate-300 bg-white p-2 text-xs font-mono text-slate-800 focus:border-blue-500 focus:outline-none"
						rows={6}
						value={editText}
						onChange={(e) => {
							setEditText(e.target.value);
							setEditError(null);
						}}
					/>
					{editError && (
						<div className="mt-1 text-xs text-red-600">
							{editError}
						</div>
					)}
					<div className="mt-2 flex gap-2">
						<button
							type="button"
							className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
							onClick={submitEdit}
						>
							Submit Edit
						</button>
						<button
							type="button"
							className="rounded bg-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-400 transition-colors"
							onClick={() => setEditing(false)}
						>
							Cancel
						</button>
					</div>
				</div>
			) : (
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
						Approve
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
						Reject
					</button>
					<button
						type="button"
						className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
						onClick={startEditing}
					>
						Edit
					</button>
				</div>
			)}
		</div>
	);
}

export function InterruptHandler() {
	useLangGraphInterrupt({
		render: ({ event, resolve }) => {
			let parsed: Record<string, unknown> = {};
			try {
				const raw = event.value;
				parsed = typeof raw === "string" ? JSON.parse(raw) : raw ?? {};
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

			return (
				<InterruptCard
					action={action}
					args={args}
					resolve={resolve}
				/>
			);
		},
	});

	return null;
}
