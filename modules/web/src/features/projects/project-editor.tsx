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
import { ColorPicker } from "@/features/organization/color-picker";
import { ProjectPicker } from "@/features/tasks/project-picker";
import { api } from "@/lib/api";
import { inProject } from "@core/workspace/focus";
import type { Color, Organization } from "@core/workspace/organization";
import {
  projectLeaf,
  projectParent,
  projectPath,
  validateProjectName,
} from "@core/workspace/projects";
import type { Task } from "@shared/tasks";
import { useEffect, useState, type FormEvent } from "react";

type ProjectEditorProps = {
  project: string;
  projects: string[];
  initialParent?: string;
  color?: Color;
  description: string;
  outcome: string;
  nextTask: string;
  revision: number;
  busy: boolean;
  blocked: boolean;
  error: string;
  onClose: () => void;
  onReload: () => Promise<Organization | undefined>;
  onSave: (
    project: string,
    description: string,
    revision: number,
    outcome: string,
    nextTask: string,
    color: Color,
  ) => Promise<boolean>;
};

export function ProjectEditor({
  project,
  projects,
  initialParent,
  color: initialColor = "gray",
  description,
  outcome: initialOutcome,
  nextTask: initialNext,
  revision,
  busy,
  blocked,
  error,
  onClose,
  onReload,
  onSave,
}: ProjectEditorProps) {
  const [color, setColor] = useState<Color>(initialColor);
  const [outcome, setOutcome] = useState(initialOutcome);
  const [nextTask, setNextTask] = useState(initialNext);
  const [choices, setChoices] = useState<Task[]>([]);
  const [choicesError, setChoicesError] = useState("");
  const [choicesLoading, setChoicesLoading] = useState(!!project);
  useEffect(() => {
    if (!project) return;
    let alive = true;
    api<{ tasks: Task[] }>("tasks?scope=pending")
      .then((result) => {
        if (alive)
          setChoices(
            result.tasks.filter((task) => inProject(task.project, project)),
          );
      })
      .catch((error) => {
        if (alive) setChoicesError((error as Error).message);
      })
      .finally(() => {
        if (alive) setChoicesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [project]);
  const [draft, setDraft] = useState(description);
  const [name, setName] = useState(projectLeaf(project));
  const [parent, setParent] = useState(initialParent ?? projectParent(project));
  const [localError, setLocalError] = useState("");
  const [draftRevision, setDraftRevision] = useState(revision);
  const [reloading, setReloading] = useState(false);
  // The editor mounts on open; refreshes keep this draft and its captured revision.
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (project === undefined || busy || blocked || reloading) return;
    if (!name.trim()) {
      setLocalError("Enter a project name.");
      document.getElementById("project-name")?.focus();
      return;
    }
    const path = parent ? parent + "." + name.trim() : name.trim();
    try {
      validateProjectName(path);
      if (name.includes("."))
        throw new Error(
          "Use Parent project to choose the hierarchy; the name cannot contain a dot.",
        );
    } catch (error) {
      setLocalError((error as Error).message);
      return;
    }
    if (await onSave(path, draft, draftRevision, outcome, nextTask, color))
      onClose();
  }
  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[480px]"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-14 text-left">
          <DialogTitle className="truncate text-base font-semibold">
            {project ? "Edit project" : "Add project"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Set the project name and description.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={submit}
          className="flex min-h-0 flex-col"
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault();
              event.currentTarget.requestSubmit();
            }
          }}
        >
          <div className="space-y-4 overflow-y-auto px-5 py-5">
            <div className="space-y-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={name}
                maxLength={200}
                autoComplete="off"
                onChange={(event) => {
                  setName(event.target.value);
                  setLocalError("");
                }}
                disabled={busy || blocked || reloading}
                className="h-10 text-base md:h-9 md:text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-color">Color</Label>
              <ColorPicker
                id="project-color"
                value={color}
                onChange={setColor}
                disabled={busy || blocked || reloading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-parent">Parent project</Label>
              <ProjectPicker
                id="project-parent"
                label="Parent project"
                value={parent}
                projects={projects.filter(
                  (name) => !project || !inProject(name, project),
                )}
                onChange={setParent}
                allowCreate={false}
                emptyLabel="No parent"
                disabled={busy || blocked || reloading}
              />
              {parent && (
                <p className="break-words text-xs text-muted-foreground">
                  {projectPath(parent)} / {name || "New project"}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-outcome">Finish line</Label>
              <Textarea
                id="project-outcome"
                value={outcome}
                onChange={(event) => setOutcome(event.target.value)}
                maxLength={500}
                placeholder="What result would make this project complete?"
                className="min-h-20 text-base md:text-sm"
                disabled={busy || blocked || reloading}
              />
            </div>
            {project && (
              <div className="space-y-2">
                <Label htmlFor="project-next">Next step</Label>
                <Select
                  value={nextTask || "none"}
                  onValueChange={(value) =>
                    setNextTask(value === "none" ? "" : value)
                  }
                  disabled={
                    busy ||
                    blocked ||
                    reloading ||
                    choicesLoading ||
                    !!choicesError
                  }
                >
                  <SelectTrigger id="project-next" className="w-full">
                    <SelectValue placeholder="Choose a task" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Choose later</SelectItem>
                    {nextTask &&
                      !choices.some((task) => task.uuid === nextTask) && (
                        <SelectItem value={nextTask}>
                          Previous task (completed or unavailable)
                        </SelectItem>
                      )}
                    {choices.map((task) => (
                      <SelectItem key={task.uuid} value={task.uuid}>
                        {task.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {choicesError && (
                  <p role="alert" className="text-sm text-destructive">
                    {choicesError} Close and reopen to reload tasks.
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label
                htmlFor="project-description"
                className="text-sm font-medium"
              >
                Description
              </Label>
              <Textarea
                id="project-description"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="What is this project about?"
                maxLength={2000}
                rows={5}
                className="min-h-32 resize-y text-base shadow-none md:text-sm"
                disabled={busy || blocked || reloading}
                aria-describedby={error ? "project-error" : undefined}
              />
              <p className="text-right text-xs tabular-nums text-muted-foreground">
                {draft.length}/2000
              </p>
            </div>
            {(error || localError) && (
              <Alert variant="destructive" id="project-error">
                <AlertDescription>
                  {localError || error}
                  {error && (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto justify-start p-0 text-current"
                      disabled={busy || reloading}
                      onClick={async () => {
                        setReloading(true);
                        try {
                          const latest = await onReload();
                          if (latest) setDraftRevision(latest.revision);
                        } finally {
                          setReloading(false);
                        }
                      }}
                    >
                      Reload and keep draft
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t px-5 py-4">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || blocked || reloading}>
              {busy ? <Spinner className="size-4" /> : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
