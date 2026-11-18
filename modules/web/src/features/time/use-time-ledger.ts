import type {
  DailyLedgerSummary,
  TimeEvent,
  TimePolicy,
  TimerSnapshot,
  TimingPlan,
} from "@core/time/model";
import { localDateOf } from "@core/time/zone";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TimePage } from "@/app/hooks/use-workspace-navigation";
import {
  ackTimeEvents,
  fetchDailySummary,
  fetchReconcileDigest,
  fetchTimeEvents,
  fetchTimePolicy,
  fetchTimeStatus,
  fetchTimingPlans,
  inspectTimeOperation,
  undoTimeOperation,
  type InspectOperationResponse,
  type TimeReceipt,
  type TimeReconcileDigest,
  type TimeStatusResponse,
} from "./time-api";
import { formatTimeErrorMessage } from "./time-format";

export type PendingOperationDetail = {
  operationId: string;
  kind: string;
  targetTaskUuid?: string;
  externalDisposition?: string;
  suggestionHint?: string;
};

export type LastUndoableReceipt = {
  operationId: string;
  label: string;
};

function todayInZone(timeZone: string): string {
  try {
    return localDateOf(Date.now(), timeZone);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Coordinates Time ledger queries, pending reconciliation details, and versioned mutations with undo receipts. */
export function useTimeLedger({
  page,
  timerSnapshot,
  onTimeMutated,
}: {
  page: TimePage;
  timerSnapshot?: TimerSnapshot | null;
  onTimeMutated: () => void;
}) {
  const [status, setStatus] = useState<TimeStatusResponse | null>(null);
  const [policy, setPolicy] = useState<TimePolicy | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    todayInZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
  );
  const [daily, setDaily] = useState<DailyLedgerSummary | null>(null);
  const [digest, setDigest] = useState<TimeReconcileDigest | null>(null);
  const [plans, setPlans] = useState<TimingPlan[]>([]);
  const [events, setEvents] = useState<TimeEvent[]>([]);
  const [pendingDetails, setPendingDetails] = useState<
    PendingOperationDetail[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastUndoable, setLastUndoable] = useState<LastUndoableReceipt | null>(
    null,
  );

  const loadGeneration = useRef(0);
  const queryRef = useRef({ page, selectedDate, timeZone: policy?.timezone });
  queryRef.current = { page, selectedDate, timeZone: policy?.timezone };
  const loadData = useCallback(async () => {
    const { page, selectedDate } = queryRef.current;
    const request = ++loadGeneration.current;
    setLoading(true);
    setError("");
    try {
      const [nextStatus, nextPolicy] = await Promise.all([
        fetchTimeStatus(),
        fetchTimePolicy(),
      ]);
      if (request !== loadGeneration.current) return;
      setStatus(nextStatus);
      setPolicy(nextPolicy);

      if (page === "today") {
        const targetDate =
          selectedDate || todayInZone(nextPolicy.timezone || "UTC");
        const [nextDaily, nextDigest, nextPlans, nextEvents] =
          await Promise.all([
            fetchDailySummary(targetDate),
            fetchReconcileDigest(targetDate),
            fetchTimingPlans(),
            fetchTimeEvents(),
          ]);
        if (request !== loadGeneration.current) return;
        setDaily(nextDaily);
        setDigest(nextDigest);
        setPlans(nextPlans);
        setEvents(nextEvents);
        if (nextDigest.pendingOperations?.length) {
          const details = await Promise.all(
            nextDigest.pendingOperations.map(
              async (op): Promise<PendingOperationDetail> => {
                try {
                  const res: InspectOperationResponse =
                    await inspectTimeOperation(op.operationId);
                  return {
                    operationId: op.operationId,
                    kind: op.kind,
                    targetTaskUuid: op.targetTaskUuid,
                    externalDisposition: op.externalDisposition,
                    suggestionHint: res.suggestionHint,
                  };
                } catch {
                  return {
                    operationId: op.operationId,
                    kind: op.kind,
                    targetTaskUuid: op.targetTaskUuid,
                    externalDisposition: op.externalDisposition,
                  };
                }
              },
            ),
          );
          if (request !== loadGeneration.current) return;
          setPendingDetails(details);
        } else {
          setPendingDetails([]);
        }
      }
    } catch (err) {
      if (request !== loadGeneration.current) return;
      setError(
        formatTimeErrorMessage(
          err,
          queryRef.current.timeZone ||
            Intl.DateTimeFormat().resolvedOptions().timeZone ||
            "UTC",
        ),
      );
    } finally {
      if (request === loadGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    return () => {
      loadGeneration.current++;
    };
  }, [
    loadData,
    page,
    selectedDate,
    timerSnapshot?.timeEpoch,
    timerSnapshot?.taskDataEpoch,
    timerSnapshot?.sessionVersion,
    timerSnapshot?.state,
  ]);

  // Refresh automatically when a capped activity hits autoStopAt or an uncapped activity reaches reviewDueAt
  useEffect(() => {
    const active = status?.activeActivity;
    if (page !== "today" || !active || active.endMs !== undefined) return;
    const targetMs = active.autoStopAtMs ?? active.reviewDueAtMs;
    if (targetMs === undefined) return;
    const delayMs = Math.max(
      250,
      Math.min(2_147_483_647, targetMs - Date.now() + 400),
    );
    const timer = window.setTimeout(() => {
      void loadData();
      onTimeMutated();
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [
    page,
    status?.activeActivity?.id,
    status?.activeActivity?.version,
    status?.activeActivity?.autoStopAtMs,
    status?.activeActivity?.reviewDueAtMs,
    status?.activeActivity?.endMs,
    loadData,
    onTimeMutated,
  ]);

  const runMutation = useCallback(
    async <T extends TimeReceipt | Record<string, unknown>>(
      label: string,
      fn: () => Promise<T>,
      options?: {
        undoable?: boolean;
        onError?: (message: string) => void;
      },
    ): Promise<T | undefined> => {
      setBusy(true);
      if (!options?.onError) setError("");
      try {
        const result = await fn();
        const opId =
          typeof result === "object" &&
          result !== null &&
          "operationId" in result &&
          typeof result.operationId === "string"
            ? result.operationId
            : undefined;
        if (options?.undoable && opId) {
          setLastUndoable({ operationId: opId, label });
        }
        await loadData();
        onTimeMutated();
        return result;
      } catch (err) {
        const msg = formatTimeErrorMessage(
          err,
          policy?.timezone ||
            Intl.DateTimeFormat().resolvedOptions().timeZone ||
            "UTC",
        );
        // A failed response may follow a committed write or a successful first
        // step (for example, saving a plan before starting it). Reconcile before
        // presenting the error so retries use the current server version.
        await loadData();
        onTimeMutated();
        if (options?.onError) {
          options.onError(msg);
        } else {
          setError(msg);
        }
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [loadData, onTimeMutated, policy?.timezone],
  );

  const handleUndoLast = useCallback(async () => {
    if (!lastUndoable) return;
    const target = lastUndoable;
    setBusy(true);
    setError("");
    try {
      await undoTimeOperation(target.operationId);
      setLastUndoable(null);
      await loadData();
      onTimeMutated();
    } catch (err) {
      const msg = formatTimeErrorMessage(
        err,
        policy?.timezone ||
          Intl.DateTimeFormat().resolvedOptions().timeZone ||
          "UTC",
      );
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [lastUndoable, loadData, onTimeMutated, policy?.timezone]);

  const handleAckEvents = useCallback(
    async (eventIds: string[]) => {
      if (eventIds.length === 0) return;
      try {
        await ackTimeEvents(eventIds);
        setEvents((prev) => prev.filter((e) => !eventIds.includes(e.id)));
      } catch (err) {
        setError(
          formatTimeErrorMessage(
            err,
            policy?.timezone ||
              Intl.DateTimeFormat().resolvedOptions().timeZone ||
              "UTC",
          ),
        );
      }
    },
    [policy?.timezone],
  );

  return {
    status,
    policy,
    selectedDate,
    setSelectedDate,
    daily,
    digest,
    plans,
    events,
    pendingDetails,
    loading,
    busy,
    error,
    setError,
    lastUndoable,
    clearUndoable: () => setLastUndoable(null),
    handleAckEvents,
    handleUndoLast,
    reload: loadData,
    runMutation,
  };
}
