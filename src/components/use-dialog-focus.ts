"use client";

import { useEffect, useRef } from "react";

/** Keep keyboard navigation inside an open dialog and restore its trigger. */
export function useDialogFocus(
  open: boolean,
  onClose: () => void,
  blocked = false,
) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const blockedRef = useRef(blocked);

  useEffect(() => {
    closeRef.current = onClose;
    blockedRef.current = blocked;
  }, [onClose, blocked]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const selector =
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]';
    const focusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(
        (element) => element.getClientRects().length > 0,
      );
    (
      dialog.querySelector<HTMLElement>("input, textarea, select") ??
      focusable()[0] ??
      dialog
    ).focus();

    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!blockedRef.current) closeRef.current();
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    dialog.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      dialog.removeEventListener("keydown", keydown);
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);
  return dialogRef;
}
