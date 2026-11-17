import { getBrowserApi } from "../shared/extension-api";
import { localizeDocument } from "../shared/i18n";
import { completeOnboarding } from "../shared/preferences";
import { buildThemeTokens, themeVariables } from "../shared/theme";
import { DEFAULT_THEME_CONFIG, type AppearanceMode } from "../shared/types";

localizeDocument();
const browser = getBrowserApi();
const sample = document.getElementById("sample");
const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-mode]")];

function showMode(mode: AppearanceMode): void {
  for (const button of buttons) {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-checked", String(active));
    button.tabIndex = active ? 0 : -1;
  }
  if (!sample) {
    return;
  }
  const tokens = buildThemeTokens({ ...DEFAULT_THEME_CONFIG, mode });
  const variables = tokens && mode !== "grayscale" ? themeVariables(tokens) : null;
  // Grayscale is a filter over the original page, so the sample shows a
  // neutral light page with the filter's desaturated palette.
  const palette = variables
    ? {
        bg: variables["--darkr-bg"],
        text: variables["--darkr-text"],
        link: variables["--darkr-link"],
        muted: variables["--darkr-muted"],
      }
    : { bg: "#ececec", text: "#151515", link: "#3a3a3a", muted: "#555555" };
  sample.style.setProperty("--sample-bg", palette.bg ?? "");
  sample.style.setProperty("--sample-text", palette.text ?? "");
  sample.style.setProperty("--sample-link", palette.link ?? "");
  sample.style.setProperty("--sample-muted", palette.muted ?? "");
}

for (const button of buttons) {
  button.addEventListener("click", () => showMode(button.dataset.mode as AppearanceMode));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = buttons[(buttons.indexOf(button) + step + buttons.length) % buttons.length];
    next?.focus();
    showMode(next?.dataset.mode as AppearanceMode);
  });
}
showMode("dark");

document.getElementById("open-settings")?.addEventListener("click", () => {
  void browser?.runtime.openOptionsPage();
});
document.getElementById("done")?.addEventListener("click", async () => {
  if (browser) {
    await completeOnboarding(browser.storage.local);
  }
  window.close();
});
