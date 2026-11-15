import { PointerSensor, TouchSensor } from "@dnd-kit/core";

function canStartDrag(target: Element | null) {
  if (!target) return false;
  if (
    target.closest(
      '[data-no-drag], button, a, input, textarea, select, [role="checkbox"], [role="combobox"], [contenteditable="true"]',
    )
  )
    return false;
  return (
    !target.closest("[data-compact='true']") ||
    Boolean(target.closest("[data-drag-handle]"))
  );
}

/** Pointer sensor that ignores interactive controls and requires drag handle in list layout. */
export class SmartPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: event }: { nativeEvent: PointerEvent }) => {
        if (
          event.pointerType === "touch" ||
          !event.isPrimary ||
          event.button !== 0
        )
          return false;
        return canStartDrag(event.target as Element | null);
      },
    },
  ];
}

/** Delay only touch input, so a normal scroll never picks up a task. */
export class SmartTouchSensor extends TouchSensor {
  static activators = [
    {
      eventName: "onTouchStart" as const,
      handler: ({ nativeEvent: event }: { nativeEvent: TouchEvent }) =>
        event.touches.length === 1 &&
        canStartDrag(event.target as Element | null),
    },
  ];
}
