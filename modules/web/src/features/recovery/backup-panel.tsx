import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Download,
  ShieldCheck,
  Upload,
} from "lucide-react";
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

const INITIAL_VISIBLE_POINTS = 5;

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

/** Workspace backup export, restore preview, and bounded restore-point history panel. */
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
  const [pointsExpanded, setPointsExpanded] = useState(false);
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
        throw new Error("请选择小于 8 MB 的备份文件。");
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
    tasks: "任务",
    projects: "项目",
    labels: "标签",
    filters: "过滤器",
    columns: "看板版块",
    intervals: "计时区间",
  };

  const visiblePoints = pointsExpanded
    ? points
    : points.slice(0, INITIAL_VISIBLE_POINTS);

  return (
    <div className="space-y-5">
      <input
        ref={fileInput}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        accept=".json,application/json"
        aria-label="选择 Aster 备份文件"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      {!preview && (
        <section className="rounded-[10px] border border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-foreground">
                工作区整库备份
              </h3>
              <p className="text-xs leading-5 text-muted-foreground">
                包含任务、项目设置、标签、过滤器、看板版块、习惯及计时历史。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={onExport}
              >
                <Download className="size-3.5" />
                导出备份
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => fileInput.current?.click()}
              >
                <Upload className="size-3.5" />
                导入恢复
              </Button>
            </div>
          </div>
        </section>
      )}

      {working && (
        <div
          role="status"
          className="flex items-center gap-2 py-2 text-xs text-muted-foreground"
        >
          <Spinner className="size-4" />
          {preview ? "正在创建还原点并恢复工作区…" : "正在校验备份文件…"}
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      {uncertain && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.location.reload()}
        >
          刷新并检查工作区状态
        </Button>
      )}

      {preview && (
        <div className="space-y-4 rounded-[10px] border border-border p-4">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-8 px-2 text-xs text-muted-foreground"
            disabled={working}
            onClick={() => setPreview(undefined)}
          >
            <ArrowLeft className="size-3.5" />
            返回备份管理
          </Button>
          <div>
            <h3 className="truncate text-sm font-medium">{filename}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              导出时间：{new Date(preview.exportedAt).toLocaleString()}
            </p>
          </div>
          <table className="w-full table-fixed text-xs">
            <caption className="sr-only">备份恢复内容对比</caption>
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="w-1/2 py-2 text-left font-normal">数据类型</th>
                <th className="py-2 text-right font-normal">当前</th>
                <th className="py-2 text-right font-normal">备份文件</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(labels) as (keyof BackupCounts)[]).map((key) => (
                <tr key={key} className="border-b last:border-b-0">
                  <th scope="row" className="py-2 text-left font-normal">
                    {labels[key]}
                  </th>
                  <td className="py-2 text-right text-muted-foreground tabular-nums">
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
            恢复会替换当前工作区数据，并在覆盖前自动保留一个可下载的还原点。请先关闭其他客户端。
          </p>
          {!!preview.stoppedOccurrences && (
            <p className="text-xs leading-5 text-muted-foreground">
              备份中正在进行的计时将在导出时间点自动结束。
            </p>
          )}
          {preview.activeTimers && (
            <Alert>
              <AlertDescription className="text-xs">
                请先停止当前正在进行的计时，再重新预览并恢复此备份。
              </AlertDescription>
            </Alert>
          )}
          <Button
            className="w-full"
            size="sm"
            disabled={disabled || preview.activeTimers}
            onClick={() => setConfirm(true)}
          >
            <ShieldCheck className="size-4" />
            确认恢复此备份
          </Button>
        </div>
      )}

      {!preview && (
        <section className="rounded-[10px] border border-border p-4">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium text-foreground">自动还原点</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                每次导入备份前，系统会自动保留一份当时的工作区快照。
              </p>
            </div>
            {points.length > 0 && (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                共 {points.length} 个
              </span>
            )}
          </div>
          {pointsLoading ? (
            <div
              role="status"
              className="flex items-center gap-2 py-3 text-xs text-muted-foreground"
            >
              <Spinner className="size-3.5" />
              正在加载还原点…
            </div>
          ) : pointsError ? (
            <div
              role="alert"
              className="space-y-2 py-2 text-xs text-muted-foreground"
            >
              <p>{pointsError}</p>
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={() => void reloadPoints()}
              >
                重试
              </Button>
            </div>
          ) : !points.length ? (
            <p className="py-2 text-xs text-muted-foreground">暂无还原点</p>
          ) : (
            <>
              <div className="divide-y divide-border/50">
                {visiblePoints.map((point) => (
                  <div
                    key={point.id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-1 last:pb-1"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground tabular-nums">
                        {new Date(point.createdAt).toLocaleString()}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {point.state === "committed"
                          ? "恢复前自动保存"
                          : point.state === "rolledBack"
                            ? "恢复已回滚"
                            : "恢复曾中断"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                      disabled={disabled}
                      aria-label={`下载还原点 ${point.createdAt}`}
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
                      <Download className="size-3.5" />
                      下载
                    </Button>
                  </div>
                ))}
              </div>
              {points.length > INITIAL_VISIBLE_POINTS && (
                <div className="mt-2 border-t border-border/50 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="h-7 w-full gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setPointsExpanded((prev) => !prev)}
                  >
                    {pointsExpanded ? (
                      <>
                        <ChevronUp className="size-3.5" />
                        收起还原点
                      </>
                    ) : (
                      <>
                        <ChevronDown className="size-3.5" />
                        展开其余 {points.length - INITIAL_VISIBLE_POINTS}{" "}
                        个还原点
                      </>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>确认替换当前工作区？</AlertDialogTitle>
            <AlertDialogDescription>
              将使用预览中的备份数据替换当前工作区（包含任务、设置与计时历史）。系统会先为您保留一份可下载的还原点。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void restore()}>
              替换工作区
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
