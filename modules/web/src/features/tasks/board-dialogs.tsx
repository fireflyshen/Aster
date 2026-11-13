import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { BoardChange, BoardColumn as Column } from "@core/workspace/board";
import type { Organization } from "@core/workspace/organization";
import { BoardColumnEditor } from "./board-column-editor";
import { columnDisplayName } from "./board-helpers";

type BoardSectionDialogsProps = {
  layout: "board" | "list";
  editor?: { column: Column; revision: number };
  deleting?: { column: Column; revision: number };
  saving: boolean;
  blocked: boolean;
  error: string;
  onCloseEditor: () => void;
  onCloseDelete: () => void;
  onUpdateDeleteRevision: (revision: number) => void;
  onChange: (change: BoardChange) => Promise<boolean>;
  onReload: () => Promise<Organization | undefined>;
};

/** Renders the section rename editor and delete confirmation dialogs for TaskBoard. */
export function BoardSectionDialogs({
  layout,
  editor,
  deleting,
  saving,
  blocked,
  error,
  onCloseEditor,
  onCloseDelete,
  onUpdateDeleteRevision,
  onChange,
  onReload,
}: BoardSectionDialogsProps) {
  return (
    <>
      {editor && (
        <BoardColumnEditor
          column={editor.column}
          revision={editor.revision}
          busy={saving}
          blocked={blocked}
          error={error}
          onClose={onCloseEditor}
          onSave={onChange}
          onReload={onReload}
        />
      )}

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !saving) onCloseDelete();
        }}
      >
        <AlertDialogContent
          className="max-w-sm"
          onEscapeKeyDown={(event) => {
            if (saving) event.preventDefault();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除分区“{columnDisplayName(deleting?.column)}”？
            </AlertDialogTitle>
            <AlertDialogDescription>
              该分区下的任务将移至未分区，任务内容将被保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription className="flex items-center gap-2">
                <span>{error}</span>
                <Button
                  variant="link"
                  disabled={saving}
                  onClick={async () => {
                    const latest = await onReload();
                    if (latest) onUpdateDeleteRevision(latest.revision);
                  }}
                >
                  重新加载看板
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving || blocked}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async (event) => {
                event.preventDefault();
                if (
                  deleting &&
                  (await onChange({
                    kind: "board",
                    action: "column.delete",
                    revision: deleting.revision,
                    columnId: deleting.column.id,
                  }))
                ) {
                  onCloseDelete();
                }
              }}
            >
              {saving ? (
                <Spinner className="size-4" />
              ) : layout === "list" ? (
                "删除分区"
              ) : (
                "删除列"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
