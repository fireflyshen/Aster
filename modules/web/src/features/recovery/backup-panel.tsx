import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Upload, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { api, RequestError } from "@/lib/api";
import type {
  RestorePoint,
  RestorePreview,
  BackupCounts,
} from "@shared/backup";

export function saveBackup(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function BackupPanel({
  busy,
  blocked,
  onWorking,
  onExport,
  onUnconfirmed,
}: {
  busy: boolean;
  blocked: boolean;
  onWorking: (busy: boolean) => void;
  onExport: () => void;
  onUnconfirmed: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState("");
  const [preview, setPreview] = useState<RestorePreview>();
  const [points, setPoints] = useState<RestorePoint[]>([]);
  const [pointsLoading, setPointsLoading] = useState(true);
  const [pointsError, setPointsError] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const disabled = busy || working || blocked || uncertain;
  async function reloadPoints() {
    setPointsLoading(true);
    setPointsError("");
    try {
      setPoints(
        (await api<{ points: RestorePoint[] }>("backup/points")).points,
      );
    } catch (error) {
      setPointsError((error as Error).message);
    } finally {
      setPointsLoading(false);
    }
  }
  useEffect(() => {
    void reloadPoints();
  }, []);
  function lock(value: boolean) {
    setWorking(value);
    onWorking(value);
  }
  async function upload(file: File) {
    if (disabled) return;
    setError("");
    setPreview(undefined);
    setFilename(file.name);
    lock(true);
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error("Choose a backup smaller than 8 MB.");
      const parsed: unknown = JSON.parse(await file.text());
      setPreview(await api<RestorePreview>("backup/preview", parsed));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      lock(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function restore() {
    if (!preview || disabled) return;
    lock(true);
    setError("");
    try {
      await api("backup/restore", { token: preview.token });
      window.location.reload();
    } catch (error) {
      setError((error as Error).message);
      if (error instanceof RequestError && error.uncertain) {
        setUncertain(true);
        onUnconfirmed();
      }
      setPreview(undefined);
      await reloadPoints();
    } finally {
      lock(false);
    }
  }
  const labels: Record<keyof BackupCounts, string> = {
    tasks: "Tasks",
    projects: "Projects",
    labels: "Labels",
    filters: "Filters",
    columns: "Board columns",
    intervals: "Timer intervals",
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
      <input
        ref={fileInput}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        accept=".json,application/json"
        aria-label="Choose an Aster backup"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {!preview && (
        <>
          <div className="flex flex-wrap gap-2 py-4">
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={onExport}
            >
              <Download className="size-3.5" />
              Export backup
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="size-3.5" />
              Import backup
            </Button>
          </div>
          <p className="mb-5 text-xs leading-5 text-muted-foreground">
            Backups include tasks, project settings, labels, filters, board
            columns and timer history.
          </p>
        </>
      )}
      {working && (
        <div
          role="status"
          className="flex items-center gap-2 py-4 text-sm text-muted-foreground"
        >
          <Spinner />
          {preview
            ? "Preparing a restore point and restoring…"
            : "Checking backup…"}
        </div>
      )}
      {error && (
        <Alert variant="destructive" className="my-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {uncertain && (
        <Button
          variant="outline"
          onClick={() => window.location.reload()}
          className="mb-3"
        >
          Reload and check the workspace
        </Button>
      )}
      {preview && (
        <div className="space-y-4 pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-8 px-2 text-xs text-muted-foreground"
            disabled={working}
            onClick={() => setPreview(undefined)}
          >
            <ArrowLeft className="size-3.5" />
            Back to backups
          </Button>
          <div>
            <h3 className="truncate text-sm font-medium">{filename}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Exported {new Date(preview.exportedAt).toLocaleString()}
            </p>
          </div>
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">Backup restore preview</caption>
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="w-1/2 py-2 text-left font-normal">Workspace</th>
                <th className="py-2 text-right font-normal">Current</th>
                <th className="py-2 text-right font-normal">Backup</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(labels) as (keyof BackupCounts)[]).map((key) => (
                <tr key={key} className="border-b">
                  <th scope="row" className="py-2 text-left font-normal">
                    {labels[key]}
                  </th>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {preview.current[key]}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {preview.incoming[key]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs leading-5 text-muted-foreground">
            Current data will be replaced. A downloadable restore point is saved
            first. Close other Taskwarrior and TinyCast clients before
            continuing.
          </p>
          {!!preview.stoppedOccurrences && (
            <p className="text-xs leading-5 text-muted-foreground">
              Running tasks and open timers in this backup will be restored
              stopped at the export time.
            </p>
          )}
          {preview.activeTimers && (
            <Alert>
              <AlertDescription>
                Stop your current timers, then preview this file again before
                restoring.
              </AlertDescription>
            </Alert>
          )}
          <Button
            className="w-full"
            disabled={disabled || preview.activeTimers}
            onClick={() => setConfirm(true)}
          >
            <ShieldCheck className="size-4" />
            Restore this backup
          </Button>
        </div>
      )}
      {!preview && (
        <div className="border-t pt-4">
          <h3 className="mb-1 text-sm font-medium">Restore points</h3>
          <p className="mb-3 text-xs leading-5 text-muted-foreground">
            A copy of your previous workspace is kept whenever you import a
            backup.
          </p>
          {pointsLoading ? (
            <div
              role="status"
              className="flex items-center gap-2 py-3 text-xs text-muted-foreground"
            >
              <Spinner />
              Loading restore points…
            </div>
          ) : pointsError ? (
            <div
              role="alert"
              className="space-y-2 py-3 text-xs text-muted-foreground"
            >
              <p>{pointsError}</p>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => void reloadPoints()}
              >
                Retry
              </Button>
            </div>
          ) : !points.length ? (
            <p className="py-3 text-xs text-muted-foreground">
              No restore points yet
            </p>
          ) : (
            <div className="divide-y">
              {points.map((point) => (
                <div
                  key={point.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm tabular-nums">
                      {new Date(point.createdAt).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {point.state === "committed"
                        ? "Before restore"
                        : point.state === "rolledBack"
                          ? "Restore rolled back"
                          : "Restore interrupted"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    aria-label={`Download restore point ${point.createdAt}`}
                    onClick={async () => {
                      lock(true);
                      try {
                        const data = await api(
                          `backup/download?id=${encodeURIComponent(point.id)}`,
                        );
                        saveBackup(
                          data,
                          `aster-before-restore-${point.createdAt.replace(/[:.]/g, "-")}.json`,
                        );
                      } catch (error) {
                        setError((error as Error).message);
                      } finally {
                        lock(false);
                      }
                    }}
                  >
                    <Download className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Replace this workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              This restores the tasks, settings and timer history shown in the
              preview. Your current workspace is saved as a restore point first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void restore()}>
              Replace workspace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
