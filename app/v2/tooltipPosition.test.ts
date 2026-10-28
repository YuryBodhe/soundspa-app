import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tooltipViewportPosition } from "./tooltipPosition";

test("cursor tooltip sits below and to the right when there is room", () => {
  assert.deepEqual(tooltipViewportPosition({ x: 100, y: 80 }, { width: 120, height: 32 }, { width: 600, height: 400 }), { left: 114, top: 94 });
});

test("cursor tooltip flips left and above near viewport edges", () => {
  assert.deepEqual(tooltipViewportPosition({ x: 575, y: 375 }, { width: 120, height: 32 }, { width: 600, height: 400 }), { left: 441, top: 329 });
});

test("cursor tooltip remains inside viewport when its preferred placement cannot fit", () => {
  assert.deepEqual(tooltipViewportPosition({ x: 20, y: 15 }, { width: 260, height: 120 }, { width: 280, height: 140 }), { left: 8, top: 8 });
});

test("tooltip follows pointer only during mouse hover and keeps keyboard focus element-relative", async () => {
  const source = await readFile(new URL("./Tooltip.tsx", import.meta.url), "utf8");
  assert.match(source, /onPointerMove=\{\(event\) => \{ if \(event\.pointerType !== "touch" && pointerHovering\.current\) positionAtPointer/);
  assert.match(source, /pointerHovering\.current = true/);
  assert.match(source, /pointerHovering\.current = false/);
  assert.match(source, /hovered \? s\.tooltipBubbleCursor : s\.tooltipBubbleAbove/);
  assert.match(source, /matches\(":focus-visible"\)/);
});

test("tooltip styling is translucent, non-interactive, brief, and reduced-motion aware", async () => {
  const stylesheet = await readFile(new URL("./v2.module.css", import.meta.url), "utf8");
  const tooltipStyles = stylesheet.match(/\.tooltipBubble \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(tooltipStyles, /rgba\(35, 35, 40, 0\.74\)/);
  assert.match(tooltipStyles, /backdrop-filter: blur\(8px\)/);
  assert.match(tooltipStyles, /border: 0/);
  assert.match(tooltipStyles, /pointer-events: none/);
  assert.match(tooltipStyles, /140ms ease/);
  assert.match(stylesheet, /prefers-reduced-motion: reduce/);
  assert.match(stylesheet, /\.tooltipBubbleCursor \{ position: fixed/);
  assert.match(stylesheet, /max-width: min\(220px, calc\(100vw - 16px\)\)/);
});
