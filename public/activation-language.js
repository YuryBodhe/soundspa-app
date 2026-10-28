(() => {
  const supported = ["en", "ru", "vi", "th"];
  const storageKey = "soundspa.v2.locale";
  const select = document.getElementById("activation-language");
  if (!select) return;

  const params = new URLSearchParams(window.location.search);
  const valid = (value) => supported.includes(value);
  let saved = null;
  try {
    const value = window.localStorage.getItem(storageKey);
    if (valid(value)) saved = value;
  } catch { /* Language selection remains available without storage. */ }

  const browser = window.navigator.language?.toLowerCase().split("-")[0];
  const locale = saved || (valid(params.get("lang")) ? params.get("lang") : null)
    || (valid(browser) ? browser : null)
    || (valid(document.documentElement.lang) ? document.documentElement.lang : "en");
  select.value = locale;

  const navigateWithLocale = (nextLocale, replace) => {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", nextLocale);
    if (replace) window.location.replace(url.toString());
    else window.location.assign(url.toString());
  };

  if (params.get("lang") !== locale) navigateWithLocale(locale, true);
  select.addEventListener("change", () => {
    if (!valid(select.value)) return;
    try { window.localStorage.setItem(storageKey, select.value); }
    catch { /* The language still applies to this activation link. */ }
    navigateWithLocale(select.value, false);
  });
})();
