import { getBrowserApi } from "./extension-api";

/**
 * Localised string with an English fallback. The fallback is also what unit
 * tests and browsers without `i18n` see, so the English text always lives next
 * to the code or markup that uses it and in `_locales/en/messages.json`.
 */
export function t(key: string, fallback: string, ...substitutions: string[]): string {
  try {
    const message = getBrowserApi()?.i18n?.getMessage(key, substitutions);
    return message || fallback;
  } catch {
    return fallback;
  }
}

/** Builds nodes from a message with `<b>bold</b>` and `<k>key</k>` markup, never via innerHTML. */
function richNodes(message: string): Node[] {
  const nodes: Node[] = [];
  for (const part of message.split(/(<b>.*?<\/b>|<k>.*?<\/k>)/)) {
    if (!part) {
      continue;
    }
    const tag = part.startsWith("<b>") ? "strong" : part.startsWith("<k>") ? "kbd" : null;
    if (tag) {
      const element = document.createElement(tag);
      element.textContent = part.slice(3, -4);
      nodes.push(element);
    } else {
      nodes.push(document.createTextNode(part));
    }
  }
  return nodes;
}

/**
 * Replaces the text of `[data-i18n]` elements and the attributes listed in
 * `data-i18n-attrs` (`"aria-label:key;title:other"`) with their translations.
 */
export function localizeDocument(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n;
    if (key) {
      element.textContent = t(key, element.textContent ?? "");
    }
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-rich]")) {
    const key = element.dataset.i18nRich;
    const message = key ? getBrowserApi()?.i18n?.getMessage(key) : "";
    if (message) {
      element.replaceChildren(...richNodes(message));
    }
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-attrs]")) {
    for (const pair of (element.dataset.i18nAttrs ?? "").split(";")) {
      const [attribute, key] = pair.split(":");
      if (attribute && key) {
        element.setAttribute(attribute, t(key, element.getAttribute(attribute) ?? ""));
      }
    }
  }
}
