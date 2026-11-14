import test from "node:test";
import assert from "node:assert/strict";
import { dragInputPoint } from "../src/features/tasks/drag-input.ts";
import {
  SmartPointerSensor,
  SmartTouchSensor,
} from "../src/features/tasks/smart-pointer-sensor.ts";

test("touch coordinates use the finger position, not keyboard fallback", () => {
  assert.deepEqual(
    dragInputPoint({
      touches: [{ clientX: 18, clientY: 320 }],
    } as unknown as Event),
    { x: 18, y: 320 },
  );
  assert.deepEqual(
    dragInputPoint({ clientX: 0, clientY: 15 } as unknown as Event),
    { x: 0, y: 15 },
  );
  assert.equal(dragInputPoint(new Event("keydown")), undefined);
  assert.equal(dragInputPoint({ touches: [] } as unknown as Event), undefined);
});

function target(kind: "control" | "list" | "handle" | "card") {
  return {
    closest(selector: string) {
      return (selector.includes("button") && kind === "control") ||
        (selector.includes("data-compact") &&
          (kind === "list" || kind === "handle")) ||
        (selector.includes("data-drag-handle") && kind === "handle")
        ? {}
        : null;
    },
  } as unknown as Element;
}

test("touch cannot activate the mouse sensor or drag from task controls", () => {
  const pointer = SmartPointerSensor.activators[0].handler;
  const touch = SmartTouchSensor.activators[0].handler;
  assert.equal(
    pointer({
      nativeEvent: {
        isPrimary: true,
        button: 0,
        pointerType: "touch",
        target: target("handle"),
      } as unknown as PointerEvent,
    }),
    false,
  );
  for (const kind of ["control", "list"] as const) {
    assert.equal(
      touch({
        nativeEvent: {
          touches: [{}],
          target: target(kind),
        } as unknown as TouchEvent,
      }),
      false,
    );
  }
  for (const kind of ["handle", "card"] as const) {
    assert.equal(
      touch({
        nativeEvent: {
          touches: [{}],
          target: target(kind),
        } as unknown as TouchEvent,
      }),
      true,
    );
  }
  assert.equal(
    touch({
      nativeEvent: {
        touches: [{}, {}],
        target: target("card"),
      } as unknown as TouchEvent,
    }),
    false,
  );
  assert.equal(
    pointer({
      nativeEvent: {
        isPrimary: true,
        button: 0,
        pointerType: "mouse",
        target: target("handle"),
      } as unknown as PointerEvent,
    }),
    true,
  );
});
