import {
  DragOverlay,
  useDndMonitor,
  type DragStartEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Task } from "@shared/tasks";
import {
  projectDrop,
  TASK_INDENT,
  type DragSection,
  type DropPosition,
} from "./drag-model";

type Session = {
  task: Task;
  source: HTMLElement;
  depth: number;
  origin: { x: number; y: number };
  point: { x: number; y: number };
  sections: DragSection[];
  dirty: boolean;
  keyboard: boolean;
};

/** Only this small overlay renders on pickup. Pointer motion never renders rows. */
export function TaskDragLayer({
  area,
  tasks,
  layout,
  onDrop,
}: {
  area: RefObject<HTMLDivElement | null>;
  tasks: Map<string, Task>;
  layout: "list" | "board";
  onDrop: (task: Task, position: DropPosition) => void;
}) {
  const session = useRef<Session | null>(null);
  const frame = useRef(0);
  const paintRef = useRef<() => void>(() => {});
  const indicator = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ task: Task; width: number }>();

  function measure(current: Session) {
    const root = area.current;
    if (!root) return;
    const sections: DragSection[] = [];
    for (const section of root.querySelectorAll<HTMLElement>(
      "[data-board-column]",
    )) {
      const rect = section.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const content = section.querySelector<HTMLElement>("[data-drop-content]");
      const contentRect = content?.getBoundingClientRect();
      const rows: DragSection["rows"] = [];
      for (const card of section.querySelectorAll<HTMLElement>(
        "[data-task-card]",
      )) {
        if (current.source.contains(card)) continue;
        const surface =
          layout === "list"
            ? card.querySelector<HTMLElement>("[data-task-surface]")
            : card;
        const row = surface?.getBoundingClientRect();
        if (!row?.height || !row.width) continue;
        const uuid = card.dataset.taskCard!;
        const task = tasks.get(uuid);
        let parent =
          card.parentElement?.closest<HTMLElement>("[data-task-card]");
        const parentUuid = parent?.dataset.taskCard || null;
        let depth = 0;
        while (parent) {
          depth++;
          parent =
            parent.parentElement?.closest<HTMLElement>("[data-task-card]");
        }
        rows.push({
          uuid,
          parentUuid,
          depth,
          top: row.top,
          bottom: row.bottom,
          project: task?.project || "",
          canParent: task?.status !== "completed",
        });
      }
      sections.push({
        columnId: section.dataset.boardColumn!,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        contentTop: contentRect?.height ? contentRect.top : rect.bottom,
        rows,
      });
    }
    current.sections = sections;
    current.dirty = false;
  }
  function destination(current: Session) {
    if (current.dirty) measure(current);
    return projectDrop(
      current.sections,
      current.point,
      layout,
      current.depth + (current.point.x - current.origin.x) / TASK_INDENT,
      current.task.project || "",
    );
  }
  function paint() {
    frame.current = 0;
    const current = session.current;
    const node = indicator.current;
    if (!current || !node) return;
    const target = destination(current);
    node.hidden = !target;
    if (!target) return;
    node.style.transform = `translate3d(${target.left}px, ${target.top}px, 0)`;
    node.style.width = `${target.width}px`;
    node.dataset.parent = target.parentUuid || "";
    node.dataset.column = target.columnId;
    node.dataset.before = target.beforeUuid || "";
  }
  function schedule() {
    if (!frame.current)
      frame.current = requestAnimationFrame(() => paintRef.current());
  }
  paintRef.current = paint;
  function clear() {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    session.current = null;
    if (indicator.current) indicator.current.hidden = true;
    if (area.current) delete area.current.dataset.dragActive;
    setPreview(undefined);
  }
  useEffect(() => {
    const pointer = (event: PointerEvent) => {
      if (!session.current || session.current.keyboard) return;
      session.current.point = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const invalidate = () => {
      if (session.current) {
        session.current.dirty = true;
        schedule();
      }
    };
    document.addEventListener("pointermove", pointer, { passive: true });
    document.addEventListener("scroll", invalidate, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", invalidate);
    const observer = new ResizeObserver(invalidate);
    if (area.current) observer.observe(area.current);
    return () => {
      document.removeEventListener("pointermove", pointer);
      document.removeEventListener("scroll", invalidate, true);
      window.removeEventListener("resize", invalidate);
      observer.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [area]);
  useDndMonitor({
    onDragStart(event: DragStartEvent) {
      const task = tasks.get(String(event.active.id));
      const source = area.current?.querySelector<HTMLElement>(
        `[data-task-card="${event.active.id}"]`,
      );
      if (!task || !source) return;
      const rect =
        source.querySelector("[data-task-surface]")?.getBoundingClientRect() ??
        source.getBoundingClientRect();
      const keyboard = !("clientX" in event.activatorEvent);
      const origin = keyboard
        ? { x: rect.left, y: rect.top + rect.height / 2 }
        : {
            x: Number((event.activatorEvent as PointerEvent).clientX),
            y: Number((event.activatorEvent as PointerEvent).clientY),
          };
      let parent = source.parentElement?.closest("[data-task-card]");
      let depth = 0;
      while (parent) {
        depth++;
        parent = parent.parentElement?.closest("[data-task-card]");
      }
      session.current = {
        task,
        source,
        depth,
        origin,
        point: origin,
        sections: [],
        dirty: true,
        keyboard,
      };
      if (area.current) area.current.dataset.dragActive = "true";
      setPreview({ task, width: rect.width });
      schedule();
    },
    onDragMove(event: DragMoveEvent) {
      const current = session.current;
      if (!current) return;
      if (current.keyboard)
        current.point = {
          x: current.origin.x + event.delta.x,
          y: current.origin.y + event.delta.y,
        };
      schedule();
    },
    onDragCancel: clear,
    onDragEnd() {
      const current = session.current;
      const target = current && destination(current);
      clear();
      if (current && target) onDrop(current.task, target);
    },
  });
  return (
    <>
      {createPortal(
        <div
          ref={indicator}
          hidden
          data-drop-indicator
          className="task-drop-indicator"
        />,
        document.body,
      )}
      <DragOverlay dropAnimation={null}>
        {preview && (
          <div
            data-drag-preview
            className="task-drag-preview"
            style={{ width: preview.width }}
          >
            <span className="mt-0.5 size-[18px] shrink-0 rounded-full border border-muted-foreground/60" />
            <span className="min-w-0 whitespace-normal break-words text-sm">
              {preview.task.description}
            </span>
          </div>
        )}
      </DragOverlay>
    </>
  );
}
