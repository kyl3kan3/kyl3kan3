"use client";

import { CheckCircle2, X } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

export type CompletionEvidence = {
  resolutionSummary: string;
  customerNextSteps: string;
  verificationEvidence: string;
};

export function CompleteTicketDialog({
  open,
  ticketTitle,
  completionStatus,
  pending,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  ticketTitle: string;
  completionStatus: "resolved" | "closed";
  pending: boolean;
  onCancel: () => void;
  onSubmit: (evidence: CompletionEvidence) => void;
}) {
  const [evidence, setEvidence] = useState<CompletionEvidence>({
    resolutionSummary: "",
    customerNextSteps: "",
    verificationEvidence: "",
  });

  if (!open) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(evidence);
  }

  function cancel() {
    onCancel();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#111827]/45 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !pending) cancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="complete-ticket-title"
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl ring-1 ring-[#d6cbbb] sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-[#1f6f61]">
              Completion evidence
            </p>
            <h2
              id="complete-ticket-title"
              className="mt-2 text-balance text-xl font-bold text-[#1f2937]"
            >
              Mark “{ticketTitle}” {completionStatus}
            </h2>
            <p className="mt-1 text-pretty text-sm leading-6 text-[#737064]">
              Jev reviews the recorded work against your procedure. Empty fields
              are flagged as missing evidence and excluded from quality scoring.
            </p>
          </div>
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            aria-label="Close completion form"
            className="btn-soft grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="mt-5 grid gap-4">
          <label className="grid gap-1.5 text-sm font-bold text-[#1f2937]">
            Work completed
            <textarea
              value={evidence.resolutionSummary}
              onChange={(event) =>
                setEvidence((current) => ({
                  ...current,
                  resolutionSummary: event.target.value,
                }))
              }
              rows={3}
              disabled={pending}
              placeholder="What was diagnosed, changed, and observed?"
              className="input-field resize-none px-3 py-2.5 text-sm font-normal placeholder:text-slate-400"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold text-[#1f2937]">
            Customer next steps
            <textarea
              value={evidence.customerNextSteps}
              onChange={(event) =>
                setEvidence((current) => ({
                  ...current,
                  customerNextSteps: event.target.value,
                }))
              }
              rows={3}
              disabled={pending}
              placeholder="What should the customer do, expect, or watch for?"
              className="input-field resize-none px-3 py-2.5 text-sm font-normal placeholder:text-slate-400"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold text-[#1f2937]">
            Verification performed
            <textarea
              value={evidence.verificationEvidence}
              onChange={(event) =>
                setEvidence((current) => ({
                  ...current,
                  verificationEvidence: event.target.value,
                }))
              }
              rows={3}
              disabled={pending}
              placeholder="Which check was run, and what was the result?"
              className="input-field resize-none px-3 py-2.5 text-sm font-normal placeholder:text-slate-400"
            />
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="btn-soft h-11 rounded-full px-5 text-sm font-bold disabled:opacity-60"
            >
              Keep working
            </button>
            <button
              type="submit"
              disabled={pending}
              className="btn-success inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-bold disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" />
              {pending ? "Completing…" : "Complete and review"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
