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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { FOCUS_LIMIT, inProject, projectStatus } from "@core/workspace/focus";
import type { Organization } from "@core/workspace/organization";
import { validateProjectName } from "@core/workspace/projects";
import { ArrowRight, Plus, Search, Target } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ProjectIcon } from "./project-icon";

export function FocusPicker({
  data,
  busy = false,
  error = "",
  onChoose,
  onCreateAndFocus,
  onClose,
}: {
  data: Organization;
  busy?: boolean;
  error?: string;
  onChoose: (name: string) => void;
  onCreateAndFocus?: (
    name: string,
    outcome: string,
    replaceProject?: string,
  ) => Promise<boolean>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const active = (data.projects || []).filter(
    (p) => projectStatus(p) === "active",
  );
  const available = (data.projects || []).filter(
    (p) => projectStatus(p) !== "active" && projectStatus(p) !== "completed",
  );
  const [creating, setCreating] = useState(
    () => available.length === 0 && Boolean(onCreateAndFocus),
  );
  const [newName, setNewName] = useState("");
  const [newOutcome, setNewOutcome] = useState("");
  const [replacement, setReplacement] = useState("");
  const [localError, setLocalError] = useState("");

  const projects = available
    .filter((p) =>
      `${p.name} ${p.description}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const needsReplace = active.length >= FOCUS_LIMIT;

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!onCreateAndFocus || busy) return;
    const trimmedName = newName.trim();
    const trimmedOutcome = newOutcome.trim();
    if (!trimmedName) {
      setLocalError("Enter a project name.");
      return;
    }
    try {
      validateProjectName(trimmedName);
    } catch (err) {
      setLocalError((err as Error).message);
      return;
    }
    if (!trimmedOutcome) {
      setLocalError("Define a finish line so this project stays focused.");
      return;
    }
    if (needsReplace && !replacement) {
      setLocalError("Choose an active project to pause.");
      return;
    }
    setLocalError("");
    const ok = await onCreateAndFocus(
      trimmedName,
      trimmedOutcome,
      needsReplace ? replacement : undefined,
    );
    if (ok) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[520px]">
        <DialogHeader className="border-b px-5 py-4 pr-12 text-left">
          <DialogTitle className="text-base font-semibold">
            {creating ? "New Focus project" : "Add to Focus"}
          </DialogTitle>
          <DialogDescription>
            {creating
              ? `Create a project and set its finish line. ${active.length} of ${FOCUS_LIMIT} slots used.`
              : `Choose a project from Later, or create a new one. ${active.length} of ${FOCUS_LIMIT} slots used.`}
          </DialogDescription>
        </DialogHeader>
        {active.length > 0 && !creating && (
          <div className="space-y-2 border-b bg-muted/30 px-5 py-3">
            <p className="text-xs font-medium text-muted-foreground">
              Currently in Focus
            </p>
            <div className="flex flex-wrap gap-2">
              {active.map((p) => (
                <span
                  key={p.name}
                  className="inline-flex max-w-full items-center gap-1.5 break-words rounded-md border bg-background px-2 py-1 text-xs"
                >
                  <ProjectIcon name={p.name} className="size-3" />
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        )}
        {creating && onCreateAndFocus ? (
          <form onSubmit={handleCreate} className="flex min-h-0 flex-col">
            <div className="min-h-0 space-y-4 overflow-y-auto p-5">
              <div className="space-y-2">
                <Label htmlFor="focus-new-name">Project name</Label>
                <Input
                  id="focus-new-name"
                  autoFocus
                  value={newName}
                  maxLength={200}
                  disabled={busy}
                  placeholder="e.g. Intermediate Accounting"
                  onChange={(event) => {
                    setNewName(event.target.value);
                    if (localError) setLocalError("");
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="focus-new-outcome">
                  What does done look like?
                </Label>
                <Textarea
                  id="focus-new-outcome"
                  value={newOutcome}
                  maxLength={500}
                  disabled={busy}
                  placeholder="What concrete result makes this project complete?"
                  onChange={(event) => {
                    setNewOutcome(event.target.value);
                    if (localError) setLocalError("");
                  }}
                  className="min-h-20 text-base md:text-sm"
                />
              </div>
              {needsReplace && (
                <div className="space-y-2">
                  <Label htmlFor="focus-new-replace">
                    Pause an active project to make room
                  </Label>
                  <Select
                    value={replacement}
                    onValueChange={(value) => {
                      setReplacement(value);
                      if (localError) setLocalError("");
                    }}
                    disabled={busy}
                  >
                    <SelectTrigger id="focus-new-replace" className="w-full">
                      <SelectValue placeholder="Choose an active project to pause" />
                    </SelectTrigger>
                    <SelectContent>
                      {active.map((item) => (
                        <SelectItem key={item.name} value={item.name}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {(localError || error) && (
                <Alert variant="destructive">
                  <AlertDescription>{localError || error}</AlertDescription>
                </Alert>
              )}
            </div>
            <footer className="flex shrink-0 items-center justify-between gap-2 border-t px-5 py-4">
              {available.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setCreating(false);
                    setLocalError("");
                  }}
                >
                  Choose existing ({available.length})
                </Button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
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
                  disabled={
                    busy ||
                    !newName.trim() ||
                    !newOutcome.trim() ||
                    (needsReplace && !replacement)
                  }
                >
                  {busy ? <Spinner className="size-4" /> : "Add to Focus"}
                </Button>
              </div>
            </footer>
          </form>
        ) : (
          <>
            <div className="flex items-center gap-2 px-5 pt-4 pb-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Find a project to focus on"
                  placeholder="Search projects in Later…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              {onCreateAndFocus && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNewName(query.trim());
                    setCreating(true);
                  }}
                  className="h-9 shrink-0 gap-1.5 text-xs"
                >
                  <Plus className="size-3.5" />
                  New project
                </Button>
              )}
            </div>
            <div
              className="min-h-0 space-y-0.5 overflow-y-auto px-3 pb-4"
              aria-label="Available Focus projects"
            >
              {projects.length === 0 ? (
                <div className="space-y-3 p-6 text-center text-sm text-muted-foreground">
                  <Target className="mx-auto size-5" />
                  <p>
                    {query
                      ? `No matching projects for “${query}”.`
                      : "No projects waiting in Later."}
                  </p>
                  {onCreateAndFocus && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setNewName(query.trim());
                        setCreating(true);
                      }}
                    >
                      <Plus className="size-3.5" />
                      {query.trim()
                        ? `Create “${query.trim()}” in Focus`
                        : "Create new project in Focus"}
                    </Button>
                  )}
                </div>
              ) : (
                projects.map((p) => {
                  const overlaps = active.filter(
                    (a) =>
                      inProject(p.name, a.name) || inProject(a.name, p.name),
                  );
                  const count = Object.entries(data.projectCounts || {}).reduce(
                    (n, [name, value]) =>
                      n + (inProject(name, p.name) ? value : 0),
                    0,
                  );
                  return (
                    <Button
                      key={p.name}
                      variant="ghost"
                      disabled={overlaps.length > 1}
                      onClick={() => onChoose(p.name)}
                      className="h-auto w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-left whitespace-normal"
                    >
                      <ProjectIcon name={p.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words font-medium">
                          {p.name}
                        </span>
                        <span className="mt-0.5 block text-xs font-normal leading-5 text-muted-foreground">
                          {overlaps.length > 1
                            ? "Pause overlapping active projects first"
                            : overlaps.length
                              ? `Replace ${overlaps[0].name} in Focus`
                              : p.outcome
                                ? `${p.outcome} · ${count} task${count === 1 ? "" : "s"}`
                                : `${count} unfinished task${count === 1 ? "" : "s"}`}
                        </span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </Button>
                  );
                })
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
