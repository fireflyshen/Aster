import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BackupPanel } from "./backup-panel";
import { api } from "@/lib/api";
import type { RecoveryList } from "@shared/recovery";

const PAGE_SIZE = 12;

function formatRestoreStatus(status: string): string {
  switch (status) {
    case "pending":
      return "待办";
    case "completed":
      return "已完成";
    case "recurring":
      return "重复任务";
    case "waiting":
      return "等待中";
    default:
      return status;
  }
}

function formatDeletedAt(raw?: string): string | undefined {
  if (!raw) return undefined;
  const iso = /^\d{8}T\d{6}Z$/.test(raw)
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`
    : raw;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(parsed));
}

/** Unified Data & Recovery panel rendered inside Settings, with server-paginated deleted tasks and backups. */
export function RecoveryPanel({
  onRestore,
  onRefresh,
  onUnconfirmed,
  onWorkingChange,
  busy,
  blocked,
  notice,
}: {
  onUnconfirmed: () => void;
  onRestore: (uuid: string) => Promise<boolean>;
  onRefresh: () => Promise<unknown>;
  onWorkingChange?: (working: boolean) => void;
  busy: boolean;
  blocked: boolean;
  notice: string;
}) {
  const [data, setData] = useState<RecoveryList>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [page, setPage] = useState(0);
  const [working, setWorking] = useState("");
  const [exportMessage, setExportMessage] = useState("");

  useEffect(() => {
    onWorkingChange?.(Boolean(working));
  }, [working, onWorkingChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = queryInput.trim();
      setPage(0);
      setActiveQuery(next);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  const loadPage = useCallback(async (targetPage: number, q: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(targetPage * PAGE_SIZE));
      if (q) params.set("q", q);
      const result = await api<RecoveryList>(`recovery?${params.toString()}`);
      const total = result.total ?? result.tasks.length;
      if (targetPage > 0 && result.tasks.length === 0 && total > 0) {
        const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
        setPage(lastPage);
        return;
      }
      setData(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(page, activeQuery);
  }, [loadPage, page, activeQuery]);

  async function restore(uuid: string) {
    setWorking(uuid);
    setError("");
    try {
      if (await onRestore(uuid)) {
        await loadPage(page, activeQuery);
      } else {
        setError("恢复未完成，请刷新后检查结果。");
      }
    } finally {
      setWorking("");
    }
  }

  async function download() {
    setWorking("export");
    setError("");
    setExportMessage("");
    try {
      const backup = await api<{ warnings: string[] }>("export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], {
          type: "application/json",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `aster-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setExportMessage(
        backup.warnings.length
          ? backup.warnings.join(" ")
          : "已下载完整工作区备份（包含计时历史）。",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking("");
    }
  }

  const disabled = busy || Boolean(working);
  const total = data?.total ?? data?.tasks.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const tasks = data?.tasks ?? [];

  return (
    <Tabs defaultValue="deleted" className="flex flex-col gap-4">
      <TabsList
        aria-label="数据与恢复分类"
        className="grid h-9 w-full grid-cols-2"
      >
        <TabsTrigger value="deleted" disabled={disabled}>
          已删除任务
        </TabsTrigger>
        <TabsTrigger value="backups" disabled={disabled}>
          备份与还原
        </TabsTrigger>
      </TabsList>

      <TabsContent value="deleted" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="搜索已删除任务"
              placeholder="搜索已删除任务（名称或项目）…"
              className="h-8 pr-7 pl-8 text-xs"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
            />
            {queryInput && (
              <button
                type="button"
                aria-label="清空搜索"
                onClick={() => setQueryInput("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            共 {total} 条
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-8 gap-1 px-2.5 text-xs"
            disabled={disabled || loading}
            onClick={() => void loadPage(page, activeQuery)}
          >
            <RefreshCw className="size-3" />
            刷新
          </Button>
        </div>

        {(error || notice || blocked) && (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span>{notice || error || "请先刷新后再试。"}</span>
              {(error || blocked) && (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={disabled}
                  onClick={async () => {
                    setWorking("refresh");
                    try {
                      await onRefresh();
                      await loadPage(page, activeQuery);
                    } finally {
                      setWorking("");
                    }
                  }}
                >
                  刷新工作区
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="rounded-[10px] border border-border">
          {loading && !data ? (
            <div role="status" className="flex justify-center py-10">
              <Spinner className="size-4" />
            </div>
          ) : !tasks.length ? (
            <p className="py-10 text-center text-xs text-muted-foreground">
              {activeQuery ? "没有匹配的已删除任务" : "暂无已删除任务"}
            </p>
          ) : (
            <div className="divide-y divide-border/50">
              {tasks.map((task) => {
                const deletedLabel = formatDeletedAt(task.deletedAt);
                return (
                  <div
                    key={task.uuid}
                    className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-(--row-hover)"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]">
                        {task.description}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
                        {task.project ? `${task.project} · ` : ""}
                        {task.finishing
                          ? "正在补全恢复位置"
                          : `恢复为${formatRestoreStatus(task.restoreStatus)}`}
                        {!task.tracked && " · 原状态未知"}
                        {deletedLabel && ` · 删除于 ${deletedLabel}`}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-7 shrink-0 gap-1 px-2.5 text-xs"
                      aria-label={`恢复：${task.description}`}
                      disabled={disabled || blocked}
                      onClick={() => void restore(task.uuid)}
                    >
                      {working === task.uuid ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <RotateCcw className="size-3.5" />
                      )}
                      恢复
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-border/60 bg-muted/25 px-3.5 py-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                第 {page + 1} / {totalPages} 页 · 共 {total} 条
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={disabled || loading || page <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="size-3.5" />
                  上一页
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={disabled || loading || page + 1 >= totalPages}
                  onClick={() =>
                    setPage((p) => Math.min(totalPages - 1, p + 1))
                  }
                >
                  下一页
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="backups" className="space-y-3">
        <BackupPanel
          busy={disabled}
          blocked={blocked}
          onWorking={(busyState) => setWorking(busyState ? "restore" : "")}
          onExport={() => void download()}
          onUnconfirmed={onUnconfirmed}
        />
        {(error || exportMessage) && (
          <p role="status" className="text-xs text-muted-foreground">
            {error || exportMessage}
          </p>
        )}
      </TabsContent>
    </Tabs>
  );
}
