import assert from "node:assert/strict";
import { resolveImageUrl, resolveMediaUrl } from "../../app/v2/mediaUrls";

const previousCdn = process.env.V2_MEDIA_CDN_BASE_URL;
const previousDelivery = process.env.V2_MEDIA_DELIVERY_BACKEND;

try {
  process.env.V2_MEDIA_CDN_BASE_URL = "https://media.example.test/";
  process.env.V2_MEDIA_DELIVERY_BACKEND = "cdn";

  assert.equal(resolveImageUrl("channel-1.jpg"), "/channel-1.jpg", "legacy root cover stays same-origin");
  assert.equal(resolveImageUrl("artwork/example.jpg"), "/artwork/example.jpg", "legacy artwork stays same-origin");
  assert.equal(resolveImageUrl("covers/channel-id/abc123.jpg"), "https://media.example.test/covers/channel-id/abc123.jpg", "immutable cover uses configured CDN");
  assert.equal(resolveImageUrl(null), null);

  assert.equal(resolveMediaUrl("music", "music/relax/relax-mix-01.mp3"), "https://media.example.test/music/relax/relax-mix-01.mp3", "music URL behavior is unchanged");
  assert.equal(resolveMediaUrl("ambient", "ambient/forest.mp3"), "https://media.example.test/ambient/forest.mp3", "ambient URL behavior is unchanged");

  process.env.V2_MEDIA_DELIVERY_BACKEND = "local";
  assert.equal(resolveMediaUrl("music", "music/relax/relax-mix-01.mp3"), "/music/relax/relax-mix-01.mp3");
  assert.equal(resolveMediaUrl("ambient", "ambient/forest.mp3"), "/noise/forest.mp3");

  assert.throws(() => resolveImageUrl("covers/../secret.jpg"), /Unsupported media key/);
  console.info("PASS: legacy image keys remain local, covers/ keys use the configured CDN, and audio URL mapping is unchanged.");
} finally {
  if (previousCdn === undefined) delete process.env.V2_MEDIA_CDN_BASE_URL;
  else process.env.V2_MEDIA_CDN_BASE_URL = previousCdn;
  if (previousDelivery === undefined) delete process.env.V2_MEDIA_DELIVERY_BACKEND;
  else process.env.V2_MEDIA_DELIVERY_BACKEND = previousDelivery;
}
