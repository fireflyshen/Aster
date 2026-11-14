import type { BoardColumn as Column } from "@core/workspace/board";
import {
  DndContext,
  KeyboardSensor,
  useSensor,
  useSensors,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import type { ComponentProps } from "react";
import { SmartPointerSensor, SmartTouchSensor } from "./smart-pointer-sensor";

type BoardAccessibility = NonNullable<
  ComponentProps<typeof DndContext>["accessibility"]
>;

/** Configures pointer/keyboard DnD sensors and screen-reader announcements for TaskBoard. */
export function useBoardDnd(layout: "board" | "list", columns: Column[]) {
  const keyboardCoordinates: KeyboardCoordinateGetter = (
    event,
    { currentCoordinates, context },
  ) => {
    const backward = layout === "list" ? "ArrowUp" : "ArrowLeft";
    const forward = layout === "list" ? "ArrowDown" : "ArrowRight";
    if (event.code !== backward && event.code !== forward) return;
    event.preventDefault();
    const current =
      context.over?.data.current?.columnId ??
      context.active?.data.current?.columnId;
    const index = columns.findIndex((item) => item.id === current);
    const target = columns[index + (event.code === forward ? 1 : -1)];
    const rect = target && context.droppableRects.get(target.id);
    if (!rect || !context.collisionRect) return;
    if (layout === "list") {
      return {
        ...currentCoordinates,
        y:
          currentCoordinates.y +
          rect.top +
          rect.height / 2 -
          (context.collisionRect.top + context.collisionRect.height / 2),
      };
    }
    return {
      ...currentCoordinates,
      x:
        currentCoordinates.x +
        rect.left +
        rect.width / 2 -
        (context.collisionRect.left + context.collisionRect.width / 2),
    };
  };

  const sensors = useSensors(
    useSensor(SmartPointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(SmartTouchSensor, {
      activationConstraint: { delay: 280, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );

  const accessibility: BoardAccessibility = {
    announcements: {
      onDragStart: ({ active }) =>
        `已拾取 ${active.data.current?.name || "任务"}。`,
      onDragOver: ({ over }) =>
        over
          ? `位于 ${columns.find((item) => item.id === over.data.current?.columnId)?.name || "当前列"} 上方。`
          : "位于看板之外，松开以取消。",
      onDragEnd: () => "任务已放置。",
      onDragCancel: () => "已取消移动。",
    },
    screenReaderInstructions: {
      draggable:
        layout === "list"
          ? "按空格拾取任务，按上下方向键选择分区，按空格放置，按 Escape 取消。"
          : "按空格拾取任务，按左右方向键选择版块，按空格放置，按 Escape 取消。",
    },
  };

  return { sensors, accessibility };
}
