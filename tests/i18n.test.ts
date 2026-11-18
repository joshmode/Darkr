import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(__dirname, "..", "src");
const messages = JSON.parse(readFileSync(join(src, "_locales/en/messages.json"), "utf8")) as Record<
  string,
  { message: string; description?: string; placeholders?: Record<string, { content: string }> }
>;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const decode = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

describe("localisation", () => {
  it("has a description for every message and valid key names", () => {
    for (const [key, entry] of Object.entries(messages)) {
      expect(key).toMatch(/^[A-Za-z0-9_@]+$/);
      expect(entry.message.length).toBeGreaterThan(0);
      expect(entry.description, key).toBeTruthy();
    }
  });

  it("defines every placeholder used in a message", () => {
    for (const [key, entry] of Object.entries(messages)) {
      const used = [...entry.message.matchAll(/\$([A-Za-z0-9_@]+)\$/g)].map((m) =>
        (m[1] ?? "").toLowerCase(),
      );
      for (const name of used) {
        expect(entry.placeholders?.[name], `${key} placeholder ${name}`).toBeDefined();
      }
    }
  });

  it("keeps HTML text in step with the English messages", () => {
    for (const file of walk(src).filter((path) => path.endsWith(".html"))) {
      const html = readFileSync(file, "utf8");
      for (const match of html.matchAll(/<(\w+)[^>]*\sdata-i18n="([^"]+)"[^>]*>([^<]*)<\/\1>/g)) {
        const [, , key, text] = match;
        expect(messages[key ?? ""], `${file}: ${key}`).toBeDefined();
        expect(decode(text ?? ""), `${file}: ${key}`).toBe(messages[key ?? ""]?.message);
      }
      for (const match of html.matchAll(
        /<(\w+)[^>]*\sdata-i18n-rich="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g,
      )) {
        const [, , key, inner] = match;
        const english = decode(
          (inner ?? "")
            .replace(/<strong>/g, "<b>")
            .replace(/<\/strong>/g, "</b>")
            .replace(/<kbd>/g, "<k>")
            .replace(/<\/kbd>/g, "</k>"),
        );
        expect(messages[key ?? ""]?.message, `${file}: ${key}`).toBe(english);
      }
      for (const match of html.matchAll(/data-i18n-attrs="([^"]+)"/g)) {
        for (const pair of (match[1] ?? "").split(";")) {
          const key = pair.split(":")[1] ?? "";
          expect(messages[key], `${file}: ${key}`).toBeDefined();
        }
      }
    }
  });

  it("only calls t() with known keys whose English matches the fallback", () => {
    for (const file of walk(src).filter((path) => path.endsWith(".ts"))) {
      const code = readFileSync(file, "utf8");
      for (const match of code.matchAll(/\bt\(\s*"([A-Za-z0-9_@]+)",\s*"([^"\\]*)"/g)) {
        const [, key, fallback] = match;
        expect(messages[key ?? ""], `${file}: ${key}`).toBeDefined();
        expect(messages[key ?? ""]?.message, `${file}: ${key}`).toBe(fallback);
      }
    }
  });

  it("covers the manifest strings", () => {
    const manifest = readFileSync(join(src, "manifest.chrome.json"), "utf8");
    for (const match of manifest.matchAll(/__MSG_(\w+)__/g)) {
      expect(messages[match[1] ?? ""]).toBeDefined();
    }
  });
});

describe("localizeDocument", () => {
  it("replaces text, attributes and rich markup from getMessage and falls back to English", async () => {
    const { localizeDocument, t } = await import("../src/shared/i18n");
    const catalog: Record<string, string> = {
      hello: "Bonjour",
      tip: "Astuce",
      rich: "<b>Gras</b> et <k>Alt</k>+<k>D</k>",
    };
    (globalThis as Record<string, unknown>).chrome = {
      i18n: {
        getMessage: (key: string, subs?: string[]) =>
          (catalog[key] ?? "").replace("$1", subs?.[0] ?? ""),
      },
    };
    document.body.innerHTML =
      '<p id="a" data-i18n="hello">Hello</p><p id="b" data-i18n="missing">Keep me</p>' +
      '<button id="c" aria-label="Tip" data-i18n-attrs="aria-label:tip">x</button>' +
      '<p id="d" data-i18n-rich="rich"><strong>Bold</strong> and <kbd>Alt</kbd>+<kbd>D</kbd></p>';
    localizeDocument();
    expect(document.getElementById("a")?.textContent).toBe("Bonjour");
    expect(document.getElementById("b")?.textContent).toBe("Keep me");
    expect(document.getElementById("c")?.getAttribute("aria-label")).toBe("Astuce");
    expect(document.getElementById("d")?.innerHTML).toBe(
      "<strong>Gras</strong> et <kbd>Alt</kbd>+<kbd>D</kbd>",
    );
    expect(t("hello", "Hello")).toBe("Bonjour");
    expect(t("absent", "Fallback")).toBe("Fallback");
    Reflect.deleteProperty(globalThis, "chrome");
    document.body.innerHTML = "";
  });
});

describe("translated catalogues", () => {
  const locales = readdirSync(join(src, "_locales")).filter((name) => name !== "en");

  it("ships at least Spanish and French", () => {
    expect(locales).toEqual(expect.arrayContaining(["es", "fr"]));
  });

  for (const locale of locales) {
    it(`${locale} has every key, the same placeholders and the same markup as English`, () => {
      const translated = JSON.parse(
        readFileSync(join(src, "_locales", locale, "messages.json"), "utf8"),
      ) as typeof messages;
      expect(Object.keys(translated).sort()).toEqual(Object.keys(messages).sort());
      for (const [key, english] of Object.entries(messages)) {
        const other = translated[key];
        expect(other?.message, `${locale}: ${key}`).toBeTruthy();
        expect(Object.keys(other?.placeholders ?? {}).sort(), `${locale}: ${key}`).toEqual(
          Object.keys(english.placeholders ?? {}).sort(),
        );
        const tokens = (text: string) =>
          [...text.matchAll(/\$[A-Za-z0-9_@]+\$|<\/?[bk]>/g)].map((m) => m[0].toLowerCase()).sort();
        expect(tokens(other?.message ?? ""), `${locale}: ${key}`).toEqual(tokens(english.message));
      }
    });
  }
});
