import { PointerSensor } from "@dnd-kit/core";

/** Pointer sensor that ignores interactive controls and requires drag handle in list layout. */
export class SmartPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: event }: { nativeEvent: PointerEvent }) => {
        if (!event.isPrimary || event.button !== 0) return false;
        const target = event.target as Element | null;
        if (!target) return true;
        if (
          target.closest(
            '[data-no-drag], button, a, input, textarea, select, [role="checkbox"], [role="combobox"], [contenteditable="true"]',
          )
        ) {
          return false;
        }
        if (target.closest("[data-drag-handle]")) return true;
        const isList = Boolean(target.closest("[data-compact='true']"));
        if (isList) {
          return Boolean(target.closest("[data-drag-handle]"));
        }
        return true;
      },
    },
  ];
}
