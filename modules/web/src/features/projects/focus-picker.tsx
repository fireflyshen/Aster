import { useState } from "react";
import { ArrowRight, Search, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FOCUS_LIMIT, inProject, projectStatus } from "@core/workspace/focus";
import type { Organization } from "@core/workspace/organization";
import { ProjectIcon } from "./project-icon";

export function FocusPicker({
  data,
  onChoose,
  onClose,
}: {
  data: Organization;
  onChoose: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const active = (data.projects || []).filter(
    (p) => projectStatus(p) === "active",
  );
  const projects = (data.projects || [])
    .filter(
      (p) => projectStatus(p) !== "active" && projectStatus(p) !== "completed",
    )
    .filter((p) =>
      `${p.name} ${p.description}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b p-5 pr-12 text-left">
          <DialogTitle>Add to Focus</DialogTitle>
          <DialogDescription>
            Choose a project, then define its finish line. {active.length} of{" "}
            {FOCUS_LIMIT} slots used.
          </DialogDescription>
        </DialogHeader>
        {active.length > 0 && (
          <div className="space-y-2 border-b bg-muted/30 px-5 py-3">
            <p className="text-xs font-medium text-muted-foreground">
              Currently in Focus
            </p>
            <div className="flex flex-wrap gap-2">
              {active.map((p) => (
                <span
                  key={p.name}
                  className="max-w-full break-words rounded-md border bg-background px-2 py-1 text-xs"
                >
                  {p.name}
                </span>
              ))}
            </div>
            {active.length >= FOCUS_LIMIT && (
              <p className="text-xs leading-5 text-muted-foreground">
                Focus is full. You can choose which project to pause in the next
                step.
              </p>
            )}
          </div>
        )}
        <div className="relative m-5 mb-2">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Find a project to focus on"
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div
          className="min-h-0 space-y-0.5 overflow-y-auto px-3 pb-4"
          aria-label="Available Focus projects"
        >
          {projects.length === 0 ? (
            <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
              <Target className="mx-auto size-5" />
              <p>
                {query
                  ? "No matching projects."
                  : "No projects waiting in Later. Create a project from All projects first."}
              </p>
            </div>
          ) : (
            projects.map((p) => {
              const overlaps = active.filter(
                (a) => inProject(p.name, a.name) || inProject(a.name, p.name),
              );
              const count = Object.entries(data.projectCounts || {}).reduce(
                (n, [name, value]) => n + (inProject(name, p.name) ? value : 0),
                0,
              );
              return (
                <Button
                  key={p.name}
                  variant="ghost"
                  disabled={overlaps.length > 1}
                  onClick={() => onChoose(p.name)}
                  className="h-auto w-full justify-start gap-3 px-3 py-3 text-left whitespace-normal"
                >
                  <ProjectIcon name={p.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium">
                      {p.name}
                    </span>
                    <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                      {overlaps.length > 1
                        ? "Pause overlapping active projects first"
                        : overlaps.length
                          ? `Replace ${overlaps[0].name} in Focus`
                          : `${count} unfinished task${count === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                </Button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
