import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type {
  Organization,
  OrganizationChange,
  SavedFilter,
} from "@core/workspace/organization";
import { ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import {
  FilterEditorDialog,
  OrganizationDeleteDialog,
} from "./organization-dialogs";
import { OrganizationRow } from "./organization-row";
import {
  freshOrganizationEntry,
  type OrganizationEntry,
} from "./organization-types";
import { TagInlineForm } from "./tag-inline-form";

function matchesSearch(entry: OrganizationEntry, search: string): boolean {
  const needle = search.trim().toLocaleLowerCase();
  if (!needle) return true;
  const fields =
    entry.kind === "filter"
      ? [entry.item.name, entry.item.description, entry.item.expression]
      : [entry.item.name];
  return fields.join(" ").toLocaleLowerCase().includes(needle);
}

/** Manages saved filters and tags with search, inline tag editing, and filter expressions. */
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
  onOpen: (entry: OrganizationEntry) => void;
  onReload: () => Promise<Organization | undefined>;
}) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<OrganizationEntry>();
  const [deleting, setDeleting] = useState<OrganizationEntry>();
  const [localError, setLocalError] = useState("");
  const [editingRevision, setEditingRevision] = useState(data.revision);
  const locked = busy || blocked;

  function edit(entry: OrganizationEntry) {
    setLocalError("");
    setEditingRevision(data.revision);
    setEditing({ ...entry, item: { ...entry.item } } as OrganizationEntry);
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
    if (
      await onChange({
        revision: editingRevision,
        action: "save",
        ...editing,
      })
    ) {
      setEditing(undefined);
    }
  }

  function renderSectionRows(kind: OrganizationEntry["kind"]) {
    const list = kind === "filter" ? data.filters : data.tags;
    return list
      .map((item) => ({ kind, item }) as OrganizationEntry)
      .filter((entry) => matchesSearch(entry, search))
      .map((entry) => {
        if (
          kind === "tag" &&
          editing?.kind === "tag" &&
          editing.item.id === entry.item.id
        ) {
          return (
            <TagInlineForm
              key={editing.item.id}
              item={editing.item}
              busy={busy}
              locked={locked}
              error={localError || error}
              onChange={(item) => {
                setLocalError("");
                setEditing({ kind: "tag", item });
              }}
              onCancel={() => {
                setEditing(undefined);
                setLocalError("");
              }}
              onSubmit={() => void save()}
            />
          );
        }
        return (
          <OrganizationRow
            key={entry.item.id}
            entry={entry}
            disabled={locked}
            onOpen={onOpen}
            onEdit={edit}
            onDelete={setDeleting}
            onFavorite={(target) =>
              void onChange({
                revision: data.revision,
                kind: target.kind,
                action: "save",
                item: { ...target.item, favorite: !target.item.favorite },
              } as OrganizationChange)
            }
          />
        );
      });
  }

  return (
    <>
      <Input
        aria-label="搜索过滤器和标签"
        placeholder="搜索过滤器和标签"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="mb-5 shadow-none"
      />
      {error && (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription>
            {error}
            <Button
              variant="link"
              className="h-auto p-0 text-current"
              onClick={() => void reload()}
              disabled={busy}
            >
              重新加载
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {loading && (
        <div
          role="status"
          className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
        >
          <Spinner className="size-4" />
          正在加载过滤器和标签…
        </div>
      )}
      {!loading &&
        (["filter", "tag"] as const).map((kind) => {
          const list = kind === "filter" ? data.filters : data.tags;
          const items = renderSectionRows(kind);
          return (
            <Collapsible key={kind} defaultOpen className="mb-6">
              <div className="flex h-11 items-center gap-2 border-b border-border/80 md:h-10">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="group -ml-2 h-8 min-w-0 flex-1 justify-start gap-2 rounded-md px-2 text-sm font-semibold hover:bg-(--row-hover) has-[>svg]:px-2"
                  >
                    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
                    <span>{kind === "filter" ? "我的过滤器" : "标签"}</span>
                    <span className="text-xs font-normal tabular-nums text-muted-foreground/75">
                      {list.length}
                    </span>
                  </Button>
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={locked}
                  aria-label={kind === "filter" ? "添加过滤器" : "添加标签"}
                  className="text-muted-foreground"
                  onClick={() => edit(freshOrganizationEntry(kind))}
                >
                  <Plus className="size-4" strokeWidth={1.5} />
                </Button>
              </div>
              <CollapsibleContent>
                {kind === "tag" &&
                  editing?.kind === "tag" &&
                  !editing.item.id && (
                    <TagInlineForm
                      item={editing.item}
                      busy={busy}
                      locked={locked}
                      error={localError || error}
                      onChange={(item) => {
                        setLocalError("");
                        setEditing({ kind: "tag", item });
                      }}
                      onCancel={() => {
                        setEditing(undefined);
                        setLocalError("");
                      }}
                      onSubmit={() => void save()}
                    />
                  )}
                {items}
                {!!search.trim() && !items.length && (
                  <p className="py-5 text-sm text-muted-foreground">
                    未找到匹配的{kind === "filter" ? "过滤器" : "标签"}
                  </p>
                )}
                {!list.length &&
                  !(kind === "tag" && editing?.kind === "tag") && (
                    <Button
                      variant="ghost"
                      onClick={() => edit(freshOrganizationEntry(kind))}
                      disabled={locked}
                      className="task-add-button my-2"
                    >
                      <Plus className="size-4" />
                      {kind === "filter" ? "添加过滤器" : "添加标签"}
                    </Button>
                  )}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      <FilterEditorDialog
        filter={
          editing?.kind === "filter" ? (editing.item as SavedFilter) : undefined
        }
        busy={busy}
        locked={locked}
        error={error}
        localError={localError}
        onClearLocalError={() => setLocalError("")}
        onChange={(item) => setEditing({ kind: "filter", item })}
        onClose={() => setEditing(undefined)}
        onSave={() => void save()}
        onReload={() => void reload()}
      />
      <OrganizationDeleteDialog
        deleting={deleting}
        busy={busy}
        locked={locked}
        error={error}
        onClose={() => setDeleting(undefined)}
        onConfirm={() => {
          if (deleting) {
            void onChange({
              revision: data.revision,
              action: "delete",
              ...deleting,
            }).then((ok) => {
              if (ok) setDeleting(undefined);
            });
          }
        }}
      />
    </>
  );
}
