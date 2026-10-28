import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const script = readFileSync(new URL("../../public/activation-language.js", import.meta.url), "utf8");

type SelectorOptions = { href?: string; saved?: string | null; browser?: string; htmlLocale?: string };

function runSelector({ href = "https://soundspa.test/activate-device/synthetic?campaign=x", saved = null, browser = "ru-RU", htmlLocale = "en" }: SelectorOptions = {}) {
  const values = new Map<string, string>();
  if (saved) values.set("soundspa.v2.locale", saved);
  const listeners = new Map<string, () => void>();
  const navigations: Array<{ method: string; url: string }> = [];
  const select: { value: string; addEventListener: (name: string, listener: () => void) => void } = { value: "", addEventListener: (name, listener) => { listeners.set(name, listener); } };
  const window = {
    location: {
      href,
      search: new URL(href).search,
      replace: (url: string) => navigations.push({ method: "replace", url }),
      assign: (url: string) => navigations.push({ method: "assign", url }),
    },
    navigator: { language: browser },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  };
  vm.runInNewContext(script, {
    document: { getElementById: () => select, documentElement: { lang: htmlLocale } },
    window, URL, URLSearchParams,
  });
  return { select, values, navigations, change: () => listeners.get("change")?.() };
}

test("activation language selector detects browser locale and keeps link path intact", () => {
  const state = runSelector();
  assert.equal(state.select.value, "ru");
  assert.equal(state.navigations[0]?.method, "replace");
  const url = new URL(state.navigations[0]!.url);
  assert.equal(url.pathname, "/activate-device/synthetic");
  assert.equal(url.searchParams.get("campaign"), "x");
  assert.equal(url.searchParams.get("lang"), "ru");
});

test("saved locale takes precedence and manual selection persists across activation visits", () => {
  const state = runSelector({ saved: "vi" });
  assert.equal(state.select.value, "vi");
  state.select.value = "th";
  state.change();
  assert.equal(state.values.get("soundspa.v2.locale"), "th");
  assert.equal(new URL(state.navigations.at(-1)!.url).searchParams.get("lang"), "th");
});

test("unsupported saved locales fall back to browser language and invalid selections are ignored", () => {
  const state = runSelector({ saved: "xx", browser: "en-US" });
  assert.equal(state.select.value, "en");
  assert.equal(state.navigations.length, 1);
  assert.equal(state.navigations[0]?.method, "replace");
  state.select.value = "xx";
  state.change();
  assert.equal(state.values.get("soundspa.v2.locale"), "xx");
  assert.equal(state.navigations.length, 1);
});
