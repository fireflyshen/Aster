import test from "node:test";
import assert from "node:assert/strict";
import {
  projectDrop,
  type DragSection,
} from "../src/features/tasks/drag-model.ts";
const section: DragSection = {
  columnId: "a",
  left: 100,
  right: 600,
  top: 50,
  bottom: 300,
  contentTop: 90,
  rows: [
    {
      uuid: "parent",
      parentUuid: null,
      depth: 0,
      top: 100,
      bottom: 140,
      project: "",
      canParent: true,
    },
    {
      uuid: "child",
      parentUuid: "parent",
      depth: 1,
      top: 140,
      bottom: 180,
      project: "",
      canParent: true,
    },
    {
      uuid: "next",
      parentUuid: null,
      depth: 0,
      top: 180,
      bottom: 220,
      project: "",
      canParent: true,
    },
  ],
};
test("leftward drag promotes a child after the whole parent subtree", () => {
  const drop = projectDrop([section], { x: 100, y: 145 }, "list", 0, "")!;
  assert.equal(drop.parentUuid, null);
  assert.equal(drop.beforeUuid, "next");
  assert.equal(drop.top, 180);
});
test("rightward drag nests under the preceding task with an indented marker", () => {
  const drop = projectDrop([section], { x: 128, y: 135 }, "list", 1, "")!;
  assert.equal(drop.parentUuid, "parent");
  assert.equal(drop.beforeUuid, "child");
  assert.equal(drop.left, 128);
});
test("sibling reorder preserves the parent at the same indentation", () => {
  const drop = projectDrop([section], { x: 128, y: 175 }, "list", 1, "")!;
  assert.equal(drop.parentUuid, "parent");
  assert.equal(drop.beforeUuid, "next");
});
test("a different project cannot become the parent", () => {
  const drop = projectDrop([section], { x: 128, y: 135 }, "list", 1, "Other")!;
  assert.equal(drop.parentUuid, null);
  assert.equal(drop.depth, 0);
  assert.equal(drop.beforeUuid, "next");
});
test("empty section and gaps use the correct axis in list and board layouts", () => {
  const empty = {
    ...section,
    columnId: "empty",
    top: 330,
    bottom: 420,
    contentTop: 370,
    rows: [],
  };
  const list = projectDrop(
    [section, empty],
    { x: 100, y: 340 },
    "list",
    3,
    "",
  )!;
  assert.equal(list.columnId, "empty");
  assert.equal(list.parentUuid, null);
  assert.equal(list.beforeUuid, null);
  assert.equal(list.top, 370);
  const board = projectDrop(
    [section, { ...empty, left: 620, right: 880, top: 50, bottom: 300 }],
    { x: 615, y: 180 },
    "board",
    0,
    "",
  )!;
  assert.equal(board.columnId, "empty");
  assert.equal(board.parentUuid, undefined);
});
test("outside drop cancels instead of snapping to the last section", () => {
  assert.equal(
    projectDrop([section], { x: 900, y: 200 }, "list", 0, ""),
    undefined,
  );
});

test("row midpoint jitter keeps the insertion slot until the pointer clearly crosses it", () => {
  let drop = projectDrop([section], { x: 100, y: 190 }, "list", 0, "")!;
  for (const y of [199, 201, 198, 203, 200]) {
    drop = projectDrop([section], { x: 100, y }, "list", 0, "", drop)!;
    assert.equal(drop.beforeUuid, "next");
    assert.equal(drop.top, 180);
  }
  drop = projectDrop([section], { x: 100, y: 212 }, "list", 0, "", drop)!;
  assert.equal(drop.beforeUuid, null);
  drop = projectDrop([section], { x: 100, y: 199 }, "list", 0, "", drop)!;
  assert.equal(drop.beforeUuid, null);
  drop = projectDrop([section], { x: 100, y: 189 }, "list", 0, "", drop)!;
  assert.equal(drop.beforeUuid, "next");
});

test("the gap between sections has a stable target in either direction", () => {
  const next = {
    ...section,
    columnId: "b",
    top: 330,
    bottom: 420,
    contentTop: 370,
    rows: [],
  };
  let drop = projectDrop([section, next], { x: 100, y: 310 }, "list", 0, "")!;
  for (const y of [314, 316, 313, 318]) {
    drop = projectDrop([section, next], { x: 100, y }, "list", 0, "", drop)!;
    assert.equal(drop.columnId, "a");
  }
  drop = projectDrop([section, next], { x: 100, y: 335 }, "list", 0, "", drop)!;
  assert.equal(drop.columnId, "b");
  drop = projectDrop([section, next], { x: 100, y: 314 }, "list", 0, "", drop)!;
  assert.equal(drop.columnId, "b");
});

test("horizontal jitter does not accidentally change a task's parent", () => {
  let drop = projectDrop([section], { x: 128, y: 135 }, "list", 1, "")!;
  for (const depth of [0.49, 0.55, 0.4, 1.6]) {
    drop = projectDrop([section], { x: 128, y: 135 }, "list", depth, "", drop)!;
    assert.equal(drop.parentUuid, "parent");
  }
  drop = projectDrop([section], { x: 100, y: 135 }, "list", 0, "", drop)!;
  assert.equal(drop.parentUuid, null);
});

test("visual groups sharing a stored column keep independent stable targets", () => {
  const next = { ...section, top: 330, bottom: 420, contentTop: 370, rows: [] };
  let drop = projectDrop([section, next], { x: 100, y: 340 }, "list", 0, "")!;
  drop = projectDrop([section, next], { x: 100, y: 314 }, "list", 0, "", drop)!;
  assert.equal(drop.sectionIndex, 1);
  assert.equal(drop.top, 370);
});

test("the add-section/footer area is a valid append target, not a disappearing marker", () => {
  const bounds = { left: 100, right: 600, top: 50, bottom: 440 };
  const drop = projectDrop(
    [section],
    { x: 120, y: 400 },
    "list",
    0,
    "",
    undefined,
    bounds,
  )!;
  assert.equal(drop.columnId, "a");
  assert.equal(drop.beforeUuid, null);
  assert.equal(
    projectDrop([section], { x: 900, y: 400 }, "list", 0, "", drop, bounds),
    undefined,
  );
});
