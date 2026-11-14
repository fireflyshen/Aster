import { useCallback, useEffect, useRef, useState } from "react";

/** Keeps navigation and dismissal from silently discarding an editor draft. */
export function useEditorGuard(open: boolean, locked: boolean) {
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      setDirty(false);
      setPending(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || (!dirty && !locked)) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [open, dirty, locked]);

  const requestLeave = useCallback(
    (action: () => void) => {
      if (locked) return;
      if (!dirty) {
        action();
        return;
      }
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setPending(() => action);
    },
    [dirty, locked],
  );

  const discard = () => {
    if (locked) return;
    const action = pending;
    setPending(null);
    setDirty(false);
    action?.();
  };

  return {
    setDirty,
    requestLeave,
    confirming: Boolean(pending),
    cancel: () => setPending(null),
    discard,
    restoreFocus: () => returnFocus.current?.focus({ preventScroll: true }),
  };
}
