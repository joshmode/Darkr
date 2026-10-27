import { afterEach } from "vitest";

afterEach(() => {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});
