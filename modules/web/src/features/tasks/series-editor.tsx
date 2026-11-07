import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { RepeatSelect, RepeatEnd } from "./repeat-fields";

export function SeriesEditor({
  uuid,
  busy,
  blocked,
  notice,
  onClose,
  onSave,
  onStop,
}: {
  uuid: string;
  busy: boolean;
  blocked: boolean;
  notice: string;
  onClose: () => void;
  onSave: (recur: string, until: string) => Promise<boolean>;
  onStop: () => Promise<boolean>;
}) {
  const [data, setData] = useState<{
    description: string;
    recur: string;
    until: string;
  }>();
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let alive = true;
    api<{ description: string; recur: string; until: string }>(
      `recurrence?uuid=${encodeURIComponent(uuid)}`,
    ).then(
      (data) => {
        if (alive) setData(data);
      },
      (error) => {
        if (alive) setError(error.message);
      },
    );
    return () => {
      alive = false;
    };
  }, [uuid]);
  return (
    <>
      <div className="flex min-h-0 flex-col">
        <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-5 pb-5">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-8 px-2 text-xs text-muted-foreground"
            disabled={busy}
            onClick={onClose}
          >
            <ArrowLeft className="size-3.5" />
            Back to task
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            Changes apply to future occurrences. Existing tasks keep their
            dates.
          </p>

          {data ? (
            <>
              <p className="text-sm [overflow-wrap:anywhere]">
                {data.description}
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label
                    htmlFor="repeat"
                    className="text-xs font-normal text-muted-foreground"
                  >
                    Repeat
                  </Label>
                  <RepeatSelect
                    value={data.recur}
                    disabled={busy || blocked}
                    allowNone={false}
                    onChange={(recur) => setData({ ...data, recur })}
                  />
                </div>
                <RepeatEnd
                  value={data.until}
                  disabled={busy || blocked}
                  onChange={(until) => setData({ ...data, until })}
                />
              </div>
            </>
          ) : (
            !error && <Spinner />
          )}
          {(error || notice) && (
            <Alert variant="destructive">
              <AlertDescription>{error || notice}</AlertDescription>
            </Alert>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between border-t px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:py-4">
          <Button
            variant="ghost"
            size="sm"
            className="h-11 px-0 text-destructive md:h-9"
            disabled={busy || blocked || !data}
            onClick={() => setConfirm(true)}
          >
            Stop series
          </Button>
          <Button
            size="sm"
            className="h-11 min-w-24 md:h-9 md:min-w-20"
            disabled={busy || blocked || !data}
            onClick={async () => {
              if (data && (await onSave(data.recur, data.until))) onClose();
            }}
          >
            {busy ? <Spinner /> : "Save"}
          </Button>
        </div>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this series?</AlertDialogTitle>
            <AlertDialogDescription>
              Existing tasks stay. No new occurrences will be created. You can
              restore the series in Data & recovery.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (await onStop()) onClose();
              }}
            >
              Stop series
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
