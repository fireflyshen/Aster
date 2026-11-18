import type { TimePolicy } from "@core/time/model";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { fetchTimePolicy, type TimeReceipt } from "./time-api";
import { formatTimeErrorMessage } from "./time-format";
import { TimeSettingsPage } from "./time-settings-page";

/** Embeds Time & Budget settings inside the unified Settings dialog with self-managed policy loading and mutation feedback. */
export function TimeSettingsPanel({
  isTimeMode,
  availableTags,
  onTimeMutated,
}: {
  isTimeMode: boolean;
  availableTags: readonly string[];
  onTimeMutated: () => void;
}) {
  const [policy, setPolicy] = useState<TimePolicy | null>(null);
  const [loading, setLoading] = useState(isTimeMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState("");

  const loadPolicy = useCallback(async () => {
    if (!isTimeMode) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setPolicy(await fetchTimePolicy());
    } catch (err) {
      setError(
        formatTimeErrorMessage(
          err,
          Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [isTimeMode]);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  const runMutation = useCallback(
    async <T extends TimeReceipt | Record<string, unknown>>(
      label: string,
      fn: () => Promise<T>,
    ): Promise<T | undefined> => {
      setBusy(true);
      setError("");
      setSavedNotice("");
      try {
        const result = await fn();
        await loadPolicy();
        onTimeMutated();
        setSavedNotice(label);
        return result;
      } catch (err) {
        setError(
          formatTimeErrorMessage(
            err,
            policy?.timezone ||
              Intl.DateTimeFormat().resolvedOptions().timeZone ||
              "UTC",
          ),
        );
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [loadPolicy, onTimeMutated, policy?.timezone],
  );

  if (!isTimeMode) {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        当前服务端以兼容模式运行（`TIME_ENABLED=0`），Time
        账本暂未启用。移除该环境变量并重启服务端即可使用时间与预算设置。
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>{error}</span>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => void loadPolicy()}
            >
              重新加载
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {savedNotice && !error && (
        <p role="status" className="text-xs font-medium text-primary">
          {savedNotice}
        </p>
      )}
      {loading && !policy ? (
        <div
          role="status"
          className="flex items-center gap-2 py-8 text-xs text-muted-foreground"
        >
          <Spinner className="size-4" />
          加载时间与预算设置…
        </div>
      ) : policy ? (
        <TimeSettingsPage
          policy={policy}
          availableTags={availableTags}
          busy={busy}
          runMutation={runMutation}
        />
      ) : null}
    </div>
  );
}
