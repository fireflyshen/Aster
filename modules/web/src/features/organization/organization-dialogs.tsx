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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { SavedFilter } from "@core/workspace/organization";
import { CircleHelp } from "lucide-react";
import { ColorPicker } from "./color-picker";
import type { OrganizationEntry } from "./organization-types";

type FilterEditorDialogProps = {
  filter?: SavedFilter;
  busy: boolean;
  locked: boolean;
  error: string;
  localError: string;
  onClearLocalError: () => void;
  onChange: (item: SavedFilter) => void;
  onClose: () => void;
  onSave: () => void;
  onReload: () => void;
};

/** Modal dialog for creating or editing a saved filter query and metadata. */
export function FilterEditorDialog({
  filter,
  busy,
  locked,
  error,
  localError,
  onClearLocalError,
  onChange,
  onClose,
  onSave,
  onReload,
}: FilterEditorDialogProps) {
  return (
    <Dialog
      open={Boolean(filter)}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent
        data-organization-editor
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById("organization-name")?.focus();
        }}
        showCloseButton={!busy}
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[480px]"
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        {filter && (
          <>
            <header className="flex shrink-0 items-center gap-2 border-b px-5 py-4 pr-14">
              <DialogTitle className="text-base leading-6 font-semibold">
                {filter.id ? "编辑" : "添加"}过滤器
              </DialogTitle>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="帮助"
                    className="size-6 rounded-full text-muted-foreground"
                  >
                    <CircleHelp className="size-[18px]" strokeWidth={1.5} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="text-sm leading-6">
                  支持 @标签 或 +标签、attribute:value、and / or 以及括号。
                </PopoverContent>
              </Popover>
            </header>
            <DialogDescription className="sr-only">
              设置名称、颜色、收藏状态与过滤查询表达式。
            </DialogDescription>
            <form
              className="flex min-h-0 flex-col"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                onSave();
              }}
              onChange={onClearLocalError}
            >
              <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 md:space-y-4 md:py-4">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="organization-name"
                    className="text-sm leading-5 font-medium"
                  >
                    名称
                  </Label>
                  <div className="relative">
                    <Input
                      id="organization-name"
                      value={filter.name}
                      onChange={(e) =>
                        onChange({ ...filter, name: e.target.value })
                      }
                      maxLength={60}
                      autoComplete="off"
                      disabled={locked}
                      className="h-10 pr-16 text-base md:h-8 md:text-sm"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm tabular-nums text-muted-foreground">
                      {filter.name.length}/60
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="filter-description"
                    className="text-sm leading-5 font-medium"
                  >
                    描述
                  </Label>
                  <Textarea
                    id="filter-description"
                    value={filter.description}
                    onChange={(e) =>
                      onChange({ ...filter, description: e.target.value })
                    }
                    maxLength={500}
                    disabled={locked}
                    placeholder="添加描述"
                    className="h-32 min-h-32 resize-none text-base md:h-28 md:min-h-28 md:text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="organization-color"
                    className="text-sm leading-5 font-medium"
                  >
                    颜色
                  </Label>
                  <ColorPicker
                    id="organization-color"
                    value={filter.color}
                    disabled={locked}
                    onChange={(color) => onChange({ ...filter, color })}
                  />
                </div>
                <div className="flex min-h-7 items-center gap-2.5">
                  <Switch
                    id="organization-favorite"
                    checked={filter.favorite}
                    disabled={locked}
                    onCheckedChange={(favorite) =>
                      onChange({ ...filter, favorite })
                    }
                  />
                  <Label
                    htmlFor="organization-favorite"
                    className="text-base leading-6 font-normal md:text-sm"
                  >
                    添加到收藏
                  </Label>
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="filter-expression"
                    className="text-sm leading-5 font-medium"
                  >
                    查询表达式
                  </Label>
                  <Textarea
                    id="filter-expression"
                    value={filter.expression}
                    onChange={(e) =>
                      onChange({ ...filter, expression: e.target.value })
                    }
                    maxLength={1024}
                    disabled={locked}
                    placeholder="status:pending and (@Todo or +READY)"
                    className="h-20 min-h-20 resize-none text-base md:h-16 md:min-h-16 md:text-sm"
                  />
                  <p className="text-right text-sm tabular-nums text-muted-foreground">
                    {filter.expression.length}/1024
                  </p>
                </div>
                {(localError || error) && (
                  <Alert variant="destructive" role="alert">
                    <AlertDescription>
                      {localError || error}
                      {error && (
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto p-0 text-current"
                          onClick={onReload}
                        >
                          重新加载并保留草稿
                        </Button>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
              <footer className="mx-4 flex shrink-0 justify-end gap-2 border-t py-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:py-3">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={onClose}
                  className="h-10 min-w-20 md:h-8 md:min-w-17"
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={locked}
                  className="h-10 min-w-20 md:h-8 md:min-w-17"
                >
                  {busy ? <Spinner /> : "保存"}
                </Button>
              </footer>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

type OrganizationDeleteDialogProps = {
  deleting?: OrganizationEntry;
  busy: boolean;
  locked: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
};

/** Confirmation dialog before deleting a saved filter or tag. */
export function OrganizationDeleteDialog({
  deleting,
  busy,
  locked,
  error,
  onClose,
  onConfirm,
}: OrganizationDeleteDialogProps) {
  return (
    <AlertDialog
      open={Boolean(deleting)}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            删除{deleting?.kind === "filter" ? "过滤器" : "标签"}“
            {deleting?.item.name}”？
          </AlertDialogTitle>
          <AlertDialogDescription>
            {deleting?.kind === "filter"
              ? "相关任务将被保留。"
              : "将从任务中移除此标签，任务本身将被保留。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={locked}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {busy ? <Spinner /> : "删除"}
          </AlertDialogAction>
        </AlertDialogFooter>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
