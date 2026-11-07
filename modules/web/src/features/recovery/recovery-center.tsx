import { useEffect, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BackupPanel } from "./backup-panel";
import { api } from "@/lib/api";
import type { RecoveryList } from "@shared/recovery";

export function RecoveryCenter({
  onClose,
  onRestore,
  onRefresh,
  onUnconfirmed,
  busy,
  blocked,
  notice,
}: {
  onClose: () => void;
  onUnconfirmed: () => void;
  onRestore: (uuid: string) => Promise<boolean>;
  onRefresh: () => Promise<unknown>;
  busy: boolean;
  blocked: boolean;
  notice: string;
}) {
  const [data, setData] = useState<RecoveryList>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [working, setWorking] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  async function reload() {
    setError("");
    try {
      setData(await api<RecoveryList>("recovery"));
    } catch (error) {
      setError((error as Error).message);
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  async function restore(uuid: string) {
    setWorking(uuid);
    setError("");
    try {
      if (await onRestore(uuid)) await reload();
      else setError("Recovery did not finish. Refresh to check the result.");
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
          : "Backup downloaded, including timer history.",
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setWorking("");
    }
  }
  const visible =
    data?.tasks.filter((task) =>
      `${task.description} ${task.project || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) || [];
  const disabled = busy || !!working;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !disabled) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!disabled}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]"
        onEscapeKeyDown={(e) => {
          if (disabled) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (disabled) e.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-14 text-left">
          <DialogTitle className="text-base font-medium">
            Data & recovery
          </DialogTitle>
          <DialogDescription className="text-xs leading-5">
            Restore deleted tasks and manage workspace backups.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          defaultValue="deleted"
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <TabsList
            aria-label="Data and recovery pages"
            className="mx-5 mt-4 mb-4 grid h-11 shrink-0 grid-cols-2 md:h-9"
          >
            <TabsTrigger value="deleted" disabled={disabled}>
              Deleted tasks
            </TabsTrigger>
            <TabsTrigger value="backups" disabled={disabled}>
              Backups
            </TabsTrigger>
          </TabsList>
          <TabsContent value="deleted" className="flex min-h-0 flex-col">
            <div className="relative mx-5 mb-3 shrink-0">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search deleted tasks"
                placeholder="Search deleted tasks"
                className="h-10 pl-9 md:h-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="min-h-24 overflow-y-auto overscroll-contain px-5 pb-5">
              {(error || notice || blocked) && (
                <Alert variant="destructive" className="mb-3">
                  <AlertDescription>
                    {notice || error || "Refresh before continuing."}
                  </AlertDescription>
                </Alert>
              )}
              {(error || blocked) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mb-3"
                  disabled={disabled}
                  onClick={async () => {
                    setWorking("refresh");
                    try {
                      await onRefresh();
                      await reload();
                    } finally {
                      setWorking("");
                    }
                  }}
                >
                  Refresh
                </Button>
              )}
              {exportMessage && (
                <p
                  role="status"
                  className="mb-3 text-xs leading-5 text-muted-foreground"
                >
                  {exportMessage}
                </p>
              )}
              {!data ? (
                !error && (
                  <div role="status" className="flex justify-center py-8">
                    <Spinner />
                  </div>
                )
              ) : !data.tasks.length ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No deleted tasks
                </p>
              ) : (
                <div className="divide-y">
                  {!visible.length && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No matching tasks
                    </p>
                  )}
                  {visible.map((task) => (
                    <div
                      key={task.uuid}
                      className="flex items-center gap-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-5 [overflow-wrap:anywhere]">
                          {task.description}
                        </p>
                        <p className="mt-1 text-xs leading-4 text-muted-foreground">
                          {task.project && `${task.project} · `}
                          {task.finishing
                            ? "Finish restoring placement"
                            : `Restores as ${task.restoreStatus}`}
                          {!task.tracked && " · original status unavailable"}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Restore: ${task.description}`}
                        disabled={disabled || blocked}
                        onClick={() => void restore(task.uuid)}
                      >
                        {working === task.uuid ? (
                          <Spinner />
                        ) : (
                          <RotateCcw className="size-3.5" />
                        )}
                        Restore
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
          <TabsContent
            value="backups"
            className="flex min-h-0 flex-col overflow-hidden"
          >
            <BackupPanel
              busy={busy || !!working}
              blocked={blocked}
              onWorking={(busy) => setWorking(busy ? "restore" : "")}
              onExport={() => void download()}
              onUnconfirmed={onUnconfirmed}
            />
            {(error || exportMessage) && (
              <p
                role="status"
                className="shrink-0 px-5 pb-3 text-xs text-muted-foreground"
              >
                {error || exportMessage}
              </p>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
