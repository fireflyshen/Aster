import type {
  DailyLedgerSummary,
  TimePolicy,
  TimerSnapshot,
  WeeklyDistributionSummary,
} from "@core/time/model";
import { localDateOf } from "@core/time/zone";
import { useCallback, useEffect, useState } from "react";
import { RequestError } from "@/lib/api";
import type { TimePage } from "@/app/hooks/use-workspace-navigation";
import {
  fetchDailySummary,
  fetchReconcileDigest,
  fetchTimePolicy,
  fetchTimeStatus,
  fetchWeeklySummary,
  inspectTimeOperation,
  undoTimeOperation,
  type InspectOperationResponse,
  type TimeReceipt,
  type TimeReconcileDigest,
  type TimeStatusResponse,
} from "./time-api";

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

function errorMessage(error: unknown): string {
  if (error instanceof RequestError) return error.message;
  return error instanceof Error ? error.message : String(error);
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
  const [weekly, setWeekly] = useState<WeeklyDistributionSummary | null>(null);
  const [pendingDetails, setPendingDetails] = useState<
    PendingOperationDetail[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastUndoable, setLastUndoable] = useState<LastUndoableReceipt | null>(
    null,
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextStatus, nextPolicy] = await Promise.all([
        fetchTimeStatus(),
        fetchTimePolicy(),
      ]);
      setStatus(nextStatus);
      setPolicy(nextPolicy);

      if (page === "today") {
        const targetDate =
          selectedDate || todayInZone(nextPolicy.timezone || "UTC");
        const [nextDaily, nextDigest] = await Promise.all([
          fetchDailySummary(targetDate),
          fetchReconcileDigest(targetDate),
        ]);
        setDaily(nextDaily);
        setDigest(nextDigest);
        if (nextDigest.unresolvedOperations?.length) {
          const details = await Promise.all(
            nextDigest.unresolvedOperations.map(
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
          setPendingDetails(details);
        } else {
          setPendingDetails([]);
        }
      } else if (page === "weekly") {
        const nextWeekly = await fetchWeeklySummary(selectedDate);
        setWeekly(nextWeekly);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, selectedDate]);

  useEffect(() => {
    void loadData();
  }, [
    loadData,
    timerSnapshot?.timeEpoch,
    timerSnapshot?.taskDataEpoch,
    timerSnapshot?.sessionVersion,
    timerSnapshot?.state,
  ]);

  const runMutation = useCallback(
    async <T extends TimeReceipt | Record<string, unknown>>(
      label: string,
      fn: () => Promise<T>,
      options?: { undoable?: boolean },
    ): Promise<T | undefined> => {
      setBusy(true);
      setError("");
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
        const msg = errorMessage(err);
        setError(msg);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [loadData, onTimeMutated],
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
      const msg = errorMessage(err);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [lastUndoable, loadData, onTimeMutated]);

  return {
    status,
    policy,
    selectedDate,
    setSelectedDate,
    daily,
    digest,
    weekly,
    pendingDetails,
    loading,
    busy,
    error,
    setError,
    lastUndoable,
    clearUndoable: () => setLastUndoable(null),
    handleUndoLast,
    reload: loadData,
    runMutation,
  };
}
