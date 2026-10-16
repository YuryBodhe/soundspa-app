import assert from "node:assert/strict";
import test from "node:test";
import { activatePlayerChannelCard } from "./playerChannelInteraction";

test("locked channel activation opens information without selecting the channel", () => {
  let selected = 0;
  let informationOpened = 0;
  activatePlayerChannelCard({ playable: false }, () => { selected += 1; }, () => { informationOpened += 1; });
  assert.equal(selected, 0);
  assert.equal(informationOpened, 1);
});

test("playable channel activation preserves normal selection routing", () => {
  let selected = 0;
  let informationOpened = 0;
  activatePlayerChannelCard({ playable: true }, () => { selected += 1; }, () => { informationOpened += 1; });
  assert.equal(selected, 1);
  assert.equal(informationOpened, 0);
});
