import assert from "node:assert/strict";
import test from "node:test";
import { productVisibilityConfirmationReducer as reduce, type VisibilityConfirmationState } from "./visibilityConfirmation";

test("a second visibility update requires a fresh confirmation", () => {
  let state: VisibilityConfirmationState = { selectedVisibility: "public", confirmedVisibility: null };
  state = reduce(state, { type: "select", visibility: "private" });
  state = reduce(state, { type: "confirm", confirmed: true });
  assert.equal(state.confirmedVisibility, "private");

  state = reduce(state, { type: "saved" });
  assert.equal(state.confirmedVisibility, null);
  state = reduce(state, { type: "select", visibility: "disabled" });
  assert.notEqual(state.confirmedVisibility, state.selectedVisibility);
  state = reduce(state, { type: "confirm", confirmed: true });
  assert.equal(state.confirmedVisibility, "disabled");
});

test("changing the selected value invalidates confirmation for the previous value", () => {
  let state: VisibilityConfirmationState = { selectedVisibility: "public", confirmedVisibility: null };
  state = reduce(state, { type: "confirm", confirmed: true });
  assert.equal(state.confirmedVisibility, "public");
  state = reduce(state, { type: "select", visibility: "private" });
  assert.equal(state.confirmedVisibility, null);
  assert.notEqual(state.confirmedVisibility, state.selectedVisibility);
});
