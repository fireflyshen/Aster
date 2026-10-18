import { useState } from "react";
import { ChevronDown, CircleHelp, Ellipsis, Heart, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { Spinner } from "@/components/ui/spinner";
import { FilterIcon, LabelIcon } from "@/components/icons";
import {
  colors,
  itemColor,
  type Organization,
  type SavedFilter,
  type SavedTag,
  type OrganizationChange,
} from "@shared/organization";

type Entry = { kind: "filter"; item: SavedFilter } | { kind: "tag"; item: SavedTag };
const fresh = (kind: Entry["kind"]): Entry =>
  kind === "filter"
    ? {
        kind,
        item: { id: "", name: "", color: "gray", favorite: false, description: "", expression: "status:pending" },
      }
    : { kind, item: { id: "", name: "", color: "gray", favorite: false } };

export function OrganizationManager({
  data,
  error,
  busy,
  loading,
  blocked,
  onChange,
  onOpen,
  onReload,
}: {
  data: Organization;
  error: string;
  busy: boolean;
  loading: boolean;
  blocked: boolean;
  onChange: (change: OrganizationChange) => Promise<boolean>;
  onOpen: (entry: Entry) => void;
  onReload: () => Promise<Organization | undefined>;
}) {
  const [editing, setEditing] = useState<Entry>();
  const [deleting, setDeleting] = useState<Entry>();
  const [localError, setLocalError] = useState("");
  const [editingRevision, setEditingRevision] = useState(data.revision);
  const locked = busy || blocked;
  function edit(entry: Entry) {
    setLocalError("");
    setEditingRevision(data.revision);
    setEditing({ ...entry, item: { ...entry.item } } as Entry);
  }
  async function reload() {
    const result = await onReload();
    if (result) setEditingRevision(result.revision);
  }
  async function save() {
    if (!editing || locked) return;
    if (!editing.item.name.trim()) {
      setLocalError("Enter a name.");
      return;
    }
    if (await onChange({ revision: editingRevision, action: "save", ...editing })) setEditing(undefined);
  }
  const rows = (kind: Entry["kind"]) => {
    const list = kind === "filter" ? data.filters : data.tags;
    const Icon = kind === "filter" ? FilterIcon : LabelIcon;
    return list.map((item) => {
      const entry = { kind, item } as Entry;
      return (
        <div key={item.id} data-organization-row className="group flex min-h-10 items-center border-b">
          <Button
            variant="ghost"
            disabled={locked}
            onClick={() => onOpen(entry)}
            className="h-11 min-w-0 flex-1 justify-start gap-3 rounded-none px-0 font-normal hover:bg-transparent has-[>svg]:px-0 md:h-10"
          >
            <Icon className="size-[18px]" style={{ color: itemColor(item.color) }} />
            <span className="truncate">{item.name}</span>
          </Button>
          {kind === "tag" && (
            <span className="ml-3 text-xs tabular-nums text-muted-foreground">{(item as SavedTag).count || ""}</span>
          )}
          <RowMenu
            entry={entry}
            disabled={locked}
            onEdit={() => edit(entry)}
            onDelete={() => setDeleting(entry)}
            onFavorite={() =>
              void onChange({
                revision: data.revision,
                kind,
                action: "save",
                item: { ...item, favorite: !item.favorite },
              })
            }
          />
        </div>
      );
    });
  };
  return (
    <>
      {error && (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription>
            {error}
            <Button variant="link" className="h-auto p-0 text-current" onClick={() => void reload()} disabled={busy}>
              Reload
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {loading && (
        <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Loading filters and labels…
        </div>
      )}
      {!loading &&
        (["filter", "tag"] as const).map((kind) => (
          <Collapsible key={kind} defaultOpen className="mb-8">
            <div className="flex h-9 items-center gap-2 border-b">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="group relative h-8 min-w-0 flex-1 justify-start rounded-none px-0 text-sm font-semibold hover:bg-transparent has-[>svg]:px-0"
                >
                  <ChevronDown className="absolute -left-5 size-3.5 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
                  {kind === "filter" ? "Filters" : "Labels"}
                </Button>
              </CollapsibleTrigger>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={locked}
                aria-label={kind === "filter" ? "Add filter" : "Add label"}
                className="text-muted-foreground"
                onClick={() => edit(fresh(kind))}
              >
                <Plus className="size-4" strokeWidth={1.5} />
              </Button>
            </div>
            <CollapsibleContent>
              {rows(kind)}
              {!(kind === "filter" ? data.filters : data.tags).length && (
                <Button
                  variant="ghost"
                  onClick={() => edit(fresh(kind))}
                  disabled={locked}
                  className="my-2 h-9 gap-2 px-0 text-sm font-normal text-muted-foreground hover:bg-transparent has-[>svg]:px-0"
                >
                  <Plus className="size-4" />
                  {kind === "filter" ? "Add filter" : "Add label"}
                </Button>
              )}
            </CollapsibleContent>
          </Collapsible>
        ))}
      <Dialog
        open={!!editing}
        onOpenChange={(next) => {
          if (!next && !busy) setEditing(undefined);
        }}
      >
        <DialogContent
          data-organization-editor
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById("organization-name")?.focus();
          }}
          showCloseButton={!busy}
          className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[480px] [&>[data-slot=dialog-close]]:top-0.5 [&>[data-slot=dialog-close]]:right-1.5"
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          {editing && (
            <>
              <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3 pr-14">
                <DialogTitle className="text-base leading-6 font-semibold">
                  {editing.item.id ? "Edit " : "Add "}
                  {editing.kind === "filter" ? "filter" : "label"}
                </DialogTitle>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Help"
                      className="size-6 rounded-full text-muted-foreground"
                    >
                      <CircleHelp className="size-[18px]" strokeWidth={1.5} />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="text-sm leading-6">
                    {editing.kind === "filter"
                      ? "Use @label or +label, attribute:value, and / or, and parentheses."
                      : "Renaming a label updates it on tasks."}
                  </PopoverContent>
                </Popover>
              </header>
              <DialogDescription className="sr-only">
                Set name, color, and favorites{editing.kind === "filter" ? " and filter expression" : ""}.
              </DialogDescription>
              <form
                className="flex min-h-0 flex-col"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
                onChange={() => setLocalError("")}
              >
                <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 md:space-y-4 md:py-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="organization-name" className="text-sm leading-5 font-medium">
                      Name
                    </Label>
                    <div className="relative">
                      <Input
                        id="organization-name"
                        value={editing.item.name}
                        onChange={(e) =>
                          setEditing({ ...editing, item: { ...editing.item, name: e.target.value } } as Entry)
                        }
                        maxLength={60}
                        autoComplete="off"
                        disabled={locked}
                        className="h-10 pr-16 text-base md:h-8 md:text-sm"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm tabular-nums text-muted-foreground">
                        {editing.item.name.length}/60
                      </span>
                    </div>
                  </div>
                  {editing.kind === "filter" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="filter-description" className="text-sm leading-5 font-medium">
                        Description
                      </Label>
                      <Textarea
                        id="filter-description"
                        value={editing.item.description}
                        onChange={(e) =>
                          setEditing({ ...editing, item: { ...editing.item, description: e.target.value } })
                        }
                        maxLength={500}
                        disabled={locked}
                        placeholder="Add description"
                        className="h-32 min-h-32 resize-none text-base md:h-28 md:min-h-28 md:text-sm"
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="organization-color" className="text-sm leading-5 font-medium">
                      Color
                    </Label>
                    <Select
                      value={editing.item.color}
                      disabled={locked}
                      onValueChange={(color) => setEditing({ ...editing, item: { ...editing.item, color } } as Entry)}
                    >
                      <SelectTrigger
                        id="organization-color"
                        className="h-10 w-full text-base data-[size=default]:h-10 md:text-sm md:data-[size=default]:h-8"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent
                        position="popper"
                        className="max-h-[min(18.375rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] md:max-h-[min(18.875rem,var(--radix-select-content-available-height))]"
                      >
                        {colors.map((color) => (
                          <SelectItem
                            key={color.id}
                            value={color.id}
                            className="min-h-10 pl-10 pr-3 text-base md:min-h-8 md:py-1 md:text-sm [&>[data-slot=select-item-indicator]]:left-3 [&>[data-slot=select-item-indicator]]:right-auto"
                          >
                            <span
                              className="size-3.5 shrink-0 rounded-full md:size-3"
                              style={{ background: color.value }}
                            />
                            {color.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex min-h-7 items-center gap-2.5">
                    <Switch
                      id="organization-favorite"
                      checked={editing.item.favorite}
                      disabled={locked}
                      onCheckedChange={(favorite) =>
                        setEditing({ ...editing, item: { ...editing.item, favorite } } as Entry)
                      }
                    />
                    <Label htmlFor="organization-favorite" className="text-base leading-6 font-normal md:text-sm">
                      Add to favorites
                    </Label>
                  </div>
                  {editing.kind === "filter" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="filter-expression" className="text-sm leading-5 font-medium">
                        Query
                      </Label>
                      <Textarea
                        id="filter-expression"
                        value={editing.item.expression}
                        onChange={(e) =>
                          setEditing({ ...editing, item: { ...editing.item, expression: e.target.value } })
                        }
                        maxLength={1024}
                        disabled={locked}
                        placeholder="status:pending and (@Todo or +READY)"
                        className="h-20 min-h-20 resize-none text-base md:h-16 md:min-h-16 md:text-sm"
                      />
                      <p className="text-right text-sm tabular-nums text-muted-foreground">
                        {editing.item.expression.length}/1024
                      </p>
                    </div>
                  )}
                  {(localError || error) && (
                    <Alert variant="destructive" role="alert">
                      <AlertDescription>
                        {localError || error}
                        {error && (
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto p-0 text-current"
                            onClick={() => void reload()}
                          >
                            Reload and keep draft
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
                    onClick={() => setEditing(undefined)}
                    className="h-10 min-w-20 md:h-8 md:min-w-17"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={locked} className="h-10 min-w-20 md:h-8 md:min-w-17">
                    {busy ? <Spinner /> : "Save"}
                  </Button>
                </footer>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(next) => {
          if (!next && !busy) setDeleting(undefined);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleting?.kind === "filter" ? "filter" : "label"} “{deleting?.item.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.kind === "filter"
                ? "Tasks will be kept."
                : "Remove this label from tasks. Tasks will be kept."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={locked}
              onClick={(e) => {
                e.preventDefault();
                if (deleting)
                  void onChange({ revision: data.revision, action: "delete", ...deleting }).then((ok) => {
                    if (ok) setDeleting(undefined);
                  });
              }}
            >
              {busy ? <Spinner /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RowMenu({
  entry,
  disabled,
  onEdit,
  onFavorite,
  onDelete,
}: {
  entry: Entry;
  disabled: boolean;
  onEdit: () => void;
  onFavorite: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`Options: ${entry.item.name}`}
          className={cn(
            "ml-2 text-muted-foreground transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100",
            open && "md:opacity-100",
          )}
        >
          <Ellipsis className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-40 p-1"
        onCloseAutoFocus={(event) => {
          if (document.querySelector('[data-organization-editor][data-state="open"], [role="alertdialog"]'))
            event.preventDefault();
        }}
      >
        {[
          { label: "Edit", Icon: Pencil, run: onEdit },
          { label: entry.item.favorite ? "Remove from favorites" : "Add to favorites", Icon: Heart, run: onFavorite },
          { label: "Delete", Icon: Trash2, run: onDelete },
        ].map(({ label, Icon, run }) => (
          <Button
            key={label}
            variant="ghost"
            className={cn("h-9 w-full justify-start text-sm font-normal", label === "Delete" && "text-destructive")}
            onClick={() => {
              setOpen(false);
              run();
            }}
          >
            <Icon className="size-4" />
            {label}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
