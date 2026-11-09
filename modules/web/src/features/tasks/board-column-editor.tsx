import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { type BoardChange, type BoardColumn } from "@core/workspace/board";
import type { Organization } from "@core/workspace/organization";
import { useState, type FormEvent } from "react";

export function BoardColumnEditor({
  column,
  revision,
  busy,
  blocked,
  error,
  onClose,
  onSave,
  onReload,
}: {
  column: BoardColumn;
  revision: number;
  busy: boolean;
  blocked: boolean;
  error: string;
  onClose: () => void;
  onSave: (change: BoardChange) => Promise<boolean>;
  onReload: () => Promise<Organization | undefined>;
}) {
  const [name, setName] = useState(column.name);
  const [version, setVersion] = useState(revision);
  const [reloading, setReloading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || blocked || reloading || !name.trim()) return;
    if (
      await onSave({
        kind: "board",
        action: "column.save",
        revision: version,
        column: { id: column.id, name },
      })
    )
      onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-y-auto p-0 sm:max-w-[440px]"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader className="border-b px-5 py-4 pr-14 text-left">
          <DialogTitle className="text-base font-semibold">
            {column.id ? "Edit section" : "Add section"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Name your section.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <div className="space-y-5 px-5 py-5">
            <div className="space-y-2">
              <Label htmlFor="column-name">Name</Label>
              <Input
                id="column-name"
                placeholder="e.g. Review"
                value={name}
                maxLength={60}
                required
                disabled={busy || blocked || reloading}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>
                  {error}
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto justify-start p-0 text-current"
                    disabled={busy || reloading}
                    onClick={async () => {
                      setReloading(true);
                      try {
                        const latest = await onReload();
                        if (latest) setVersion(latest.revision);
                      } finally {
                        setReloading(false);
                      }
                    }}
                  >
                    Reload and keep draft
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t px-5 py-4">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || blocked || reloading || !name.trim()}
            >
              {busy ? <Spinner className="size-4" /> : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
