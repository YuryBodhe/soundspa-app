import assert from "node:assert/strict";
import test from "node:test";
import { renderDeviceActivationPage, resolveDeviceActivationLocale } from "./route";

test("activation page respects a validated account language hint and keeps English available", async () => {
  const russian = new Request("https://soundspa.test/activate-device/token?lang=ru", { headers: { "accept-language": "en-US" } });
  assert.equal(resolveDeviceActivationLocale(russian), "ru");
  const russianHtml = await renderDeviceActivationPage("ru", { organizationName: "Тест", locationName: "Салон", deviceName: "Браузер" }).text();
  assert.match(russianHtml, /<html lang="ru">/);
  assert.match(russianHtml, /Активировать это устройство\?/);
  assert.match(russianHtml, /Подтвердить устройство|Активировать устройство/);

  const english = new Request("https://soundspa.test/activate-device/token?lang=invalid", { headers: { "accept-language": "en-US,en;q=0.9" } });
  assert.equal(resolveDeviceActivationLocale(english), "en");
  assert.match(await renderDeviceActivationPage("en", undefined, 410).text(), /This link is invalid, expired, already used, or unavailable/);
});

test("activation preview escapes customer-controlled names and does not reveal the bearer token", async () => {
  const html = await renderDeviceActivationPage("en", { organizationName: "<img src=x>", locationName: "Salon & Co", deviceName: "<script>token</script>" }).text();
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /Salon &amp; Co/);
  assert.match(html, /&lt;script&gt;token&lt;\/script&gt;/);
  assert.doesNotMatch(html, /name="token"|value="token"/);
});
