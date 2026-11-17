// Regression cases for the defects in findings.md (E-01 … E-15).
//
// KNOWN lists defects that are confirmed but not fixed yet. Their cases still
// run and must fail; one that starts passing fails the suite until its entry
// is removed here, so a fixed bug cannot stay marked as open.
import process from "node:process";
import {
  assert,
  test,
  env,
  newPage,
  setPreferences,
  isThemed,
  waitThemed,
  settle,
  poll,
  holds,
  contrastAgainstAncestor,
  colorOf,
  alphaOf,
  luminanceOf,
  knownBug,
} from "./harness.mjs";

const HOST = "127.0.0.1";

const KNOWN = {};

function defect(id, name, body) {
  if (KNOWN[id] && !process.env.DARKR_E2E_SHOW_KNOWN) knownBug(id, KNOWN[id], name, body);
  else test(`[${id}] ${name}`, body);
}

const WHITE = "rgb(255, 255, 255)";

// ---------------------------------------------------------------- E-01
async function e01Colors(page) {
  const ids = ["#head-text", "#title", "#para", "#muted"];
  const out = {};
  for (const id of ids) out[id] = await colorOf(page, id);
  return out;
}

defect("E-01", "text inside header and card is readable on a fresh load", async () => {
  const page = await newPage("/e01-surfaces");
  await settle(page);
  for (const [selector, surface] of [
    ["#head-text", "header"],
    ["#title", ".card"],
    ["#para", ".card"],
    ["#muted", ".card"],
  ]) {
    const ratio = await contrastAgainstAncestor(page, selector, surface);
    assert.ok(ratio >= 4.5, `${selector} on ${surface} is ${ratio.toFixed(2)}:1`);
  }
  const primary = luminanceOf(await colorOf(page, "#para"));
  const muted = luminanceOf(await colorOf(page, "#muted"));
  assert.ok(muted < primary, "muted text must be dimmer than primary text");
  // The same colours must come out after a restyle triggered by a preference.
  const before = await e01Colors(page);
  await setPreferences({ overrideNativeDark: true });
  await new Promise((done) => setTimeout(done, 300));
  await settle(page);
  assert.deepEqual(await e01Colors(page), before, "colours changed after a restyle");
});

// ---------------------------------------------------------------- E-02
defect("E-02", "transparent text stays transparent and partial alpha survives", async () => {
  const page = await newPage("/e02-text");
  await settle(page);
  assert.equal(alphaOf(await colorOf(page, "#pdf-span")), 0, "PDF text layer span");
  assert.equal(alphaOf(await colorOf(page, "#grad")), 0, "background-clip:text heading");
  const partial = alphaOf(await colorOf(page, "#partial"));
  assert.ok(partial > 0 && partial < 1, `semi-transparent text alpha is ${partial}`);
});

// ---------------------------------------------------------------- E-03
const frameByHost = (page, host) => page.frames().find((f) => new URL(f.url()).hostname === host);

defect("E-03", "a Never rule on the top site reaches a cross-host iframe", async () => {
  const src = `${env.altOrigin}/e02-text`;
  const page = await newPage(`/e03-top?src=${encodeURIComponent(src)}`);
  await settle(page);
  const frame = await poll(() => frameByHost(page, "localhost"), Boolean, {
    message: "viewer frame",
  });
  await settle(frame); // control: themed while the top site is themed
  await setPreferences({}, { [HOST]: { policy: "block" } });
  await waitThemed(page, false);
  await waitThemed(frame, false);
});

defect("E-03", "a fresh load under a Never rule leaves the iframe unthemed", async () => {
  await setPreferences({}, { [HOST]: { policy: "block" } });
  const src = `${env.altOrigin}/e02-text`;
  const page = await newPage(`/e03-top?src=${encodeURIComponent(src)}`);
  const frame = await poll(() => frameByHost(page, "localhost"), Boolean, {
    message: "viewer frame",
  });
  await frame.waitForLoadState("load");
  await holds(
    () => isThemed(frame),
    (v) => v === false,
    { message: "iframe stays unthemed" },
  );
});

defect("E-03", "a srcdoc iframe is themed when the top site is", async () => {
  const page = await newPage("/e03-top");
  await settle(page);
  const frame = await poll(() => page.frames().find((f) => f.url() === "about:srcdoc"), Boolean, {
    message: "srcdoc frame",
  });
  await waitThemed(frame, true);
});

// ---------------------------------------------------------------- E-04
defect("E-04", "contenteditable content is left unmodified", async () => {
  const page = await newPage("/e04-editable");
  await settle(page);
  await new Promise((done) => setTimeout(done, 300));
  const html = await page.evaluate(() => document.querySelector("#editor").innerHTML);
  assert.ok(!html.includes("data-darkr") && !html.includes("--darkr"), html);
  // Untouched markup must still be readable: children inherit the themed colours.
  assert.ok((await contrastAgainstAncestor(page, "#ep", "#editor")) >= 4.5, "editor text contrast");
  assert.notEqual(
    await colorOf(page, "#ebox", "backgroundColor"),
    WHITE,
    "boxed child stayed white",
  );
});

// ---------------------------------------------------------------- E-05
defect("E-05", "an element animated through style.transform is never unthemed", async () => {
  const page = await newPage("/e05-animated");
  await settle(page);
  const seen = await page.evaluate(
    () =>
      new Promise((done) => {
        const values = [];
        const step = () => {
          values.push(getComputedStyle(document.querySelector("#anim")).backgroundColor);
          if (values.length < 120) requestAnimationFrame(step);
          else done(values);
        };
        requestAnimationFrame(step);
      }),
  );
  const whites = seen.filter((value) => value === WHITE).length;
  assert.equal(whites, 0, `${whites} of 120 frames showed the author's white`);
});

// ---------------------------------------------------------------- E-06
defect("E-06", "cards beyond the element cap are themed", async () => {
  const page = await newPage("/e06-many-cards");
  await waitThemed(page);
  const state = (index) =>
    page.evaluate((i) => {
      const card = document.querySelector(`#c${i}`);
      return { bg: getComputedStyle(card).backgroundColor };
    }, index);
  await poll(
    () => state(11000),
    (s) => s.bg !== "rgb(250, 250, 250)",
    { timeout: 20000, message: "card 11000 to be themed" },
  );
  for (const index of [5, 6000, 11000]) {
    assert.ok(luminanceOf((await state(index)).bg) < 0.2, `card ${index} is not dark`);
    const ratio = await page.evaluate((i) => {
      const parse = (v) => (v.match(/[\d.]+/g) ?? []).map(Number);
      const lum = ([r, g, b]) => {
        const c = (v) => {
          const x = v / 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
      };
      const p = document.querySelector(`#c${i} p`);
      const a = lum(parse(getComputedStyle(p).color));
      const b = lum(parse(getComputedStyle(p.parentElement).backgroundColor));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }, index);
    assert.ok(ratio >= 4.5, `card ${index} text is ${ratio.toFixed(2)}:1`);
  }
});

// ---------------------------------------------------------------- E-07
defect("E-07", "role=dialog, buttons and inputs keep the author's intent", async () => {
  const page = await newPage("/e07-blanket");
  await settle(page);
  assert.equal(
    alphaOf(await colorOf(page, "#overlay", "backgroundColor")),
    0,
    "transparent overlay became opaque",
  );
  const bg = await colorOf(page, "#buy", "backgroundColor");
  const [r, , b] = bg.match(/[\d.]+/g).map(Number);
  assert.ok(b > r + 20, `button background lost its blue hue: ${bg}`);
  assert.ok((await contrastAgainstAncestor(page, "#buy", "#buy")) >= 4.5, "button text contrast");
  const link = await page.evaluate(() => {
    const probe = document.createElement("i");
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--darkr-link");
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  assert.notEqual(await colorOf(page, "#buy"), link, "button text became the link token");
  const input = await colorOf(page, "#search", "backgroundColor");
  const pill = await colorOf(page, "#pill", "backgroundColor");
  assert.ok(alphaOf(input) === 0 || input === pill, `input ${input} differs from pill ${pill}`);
});

// ---------------------------------------------------------------- E-08
defect("E-08", "borders are sampled and written per side", async () => {
  const page = await newPage("/e08-borders");
  await settle(page);
  assert.equal(alphaOf(await colorOf(page, "#tri", "borderTopColor")), 0, "triangle top border");
  assert.equal(alphaOf(await colorOf(page, "#tri", "borderLeftColor")), 0, "triangle left border");
  assert.equal(alphaOf(await colorOf(page, "#ghost", "borderTopColor")), 0, "ghost border");
  assert.notEqual(
    await colorOf(page, "#row", "borderBottomColor"),
    "rgb(238, 238, 238)",
    "row rule still #eee",
  );
});

// ---------------------------------------------------------------- E-09
defect("E-09", "text over gradients and translucent bars stays readable", async () => {
  const page = await newPage("/e09-gradients");
  await settle(page);
  const ratios = await page.evaluate(() => {
    const parse = (v) => (v.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]) => {
      const c = (v) => {
        const x = v / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
    };
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const body = parse(getComputedStyle(document.body).backgroundColor);
    const out = {};
    for (const [text, box] of [
      ["#gt", "#grad"],
      ["#bt", "#bar"],
    ]) {
      const style = getComputedStyle(document.querySelector(box));
      const fg = parse(getComputedStyle(document.querySelector(text)).color);
      let stops;
      if (style.backgroundImage !== "none") {
        stops = style.backgroundImage.match(/rgba?\([^)]*\)/g).map(parse);
      } else {
        const [r, g, b, a = 1] = parse(style.backgroundColor);
        stops = [[0, 1, 2].map((i) => [r, g, b][i] * a + body[i] * (1 - a))];
      }
      out[text] = Math.min(...stops.map((stop) => ratio(fg, stop)));
    }
    return out;
  });
  for (const [selector, ratio] of Object.entries(ratios)) {
    assert.ok(ratio >= 4.5, `${selector} is ${ratio.toFixed(2)}:1 against what is painted`);
  }
});

// ---------------------------------------------------------------- E-10
defect("E-10", "a CSS-hover menu is themed when it opens", async () => {
  const page = await newPage("/e10-hover-menu");
  await settle(page);
  await page.hover("#nav");
  await poll(
    () => page.evaluate(() => getComputedStyle(document.querySelector("#menu")).display),
    (v) => v === "block",
    {
      message: "menu to open",
    },
  );
  await new Promise((done) => setTimeout(done, 300));
  assert.ok(luminanceOf(await colorOf(page, "#menu", "backgroundColor")) < 0.2, "menu is not dark");
  assert.ok((await contrastAgainstAncestor(page, "#mt", "#menu")) >= 4.5, "menu text contrast");
});

// ---------------------------------------------------------------- E-11
defect("E-11", "print media shows the author's colours", async () => {
  const page = await newPage("/e01-surfaces");
  await settle(page);
  await page.emulateMedia({ media: "print" });
  await new Promise((done) => setTimeout(done, 100));
  assert.equal(await colorOf(page, "body", "backgroundColor"), "rgb(244, 244, 244)");
  assert.equal(await colorOf(page, "body"), "rgb(17, 17, 17)");
});

// ---------------------------------------------------------------- E-12
defect("E-12", "the theme returns after page code resets the root class", async () => {
  const page = await newPage("/e01-surfaces");
  await settle(page);
  await page.evaluate(() => {
    document.documentElement.className = "x";
  });
  await poll(() => isThemed(page), Boolean, {
    timeout: 500,
    message: "theme after className reset",
  });
});

defect("E-12", "the theme returns after page code removes the stylesheet", async () => {
  const page = await newPage("/e01-surfaces");
  await settle(page);
  await page.evaluate(() => document.querySelector("#darkr-theme-styles").remove());
  await poll(() => page.evaluate(() => !!document.querySelector("#darkr-theme-styles")), Boolean, {
    timeout: 500,
    message: "stylesheet to be reinstalled",
  });
});

// ---------------------------------------------------------------- E-15
defect("E-15", "inline SVG fills are lightened on a dark page", async () => {
  const page = await newPage("/e15-svg");
  await settle(page);
  const fill = await colorOf(page, "#icon", "fill");
  const bg = await colorOf(page, "body", "backgroundColor");
  const a = luminanceOf(fill);
  const b = luminanceOf(bg);
  assert.ok(a > b && (a + 0.05) / (b + 0.05) >= 3, `path ${fill} on ${bg}`);
});

// ---------------------------------------------------------------- E-21
test("[E-21] nothing is applied under forced colors", async () => {
  const page = await newPage("/e01-surfaces");
  await settle(page);
  await page.emulateMedia({ forcedColors: "active" });
  await waitThemed(page, false);
  assert.equal(await page.evaluate(() => !!document.querySelector("#darkr-theme-styles")), false);
  await page.emulateMedia({ forcedColors: "none" });
  await waitThemed(page, true);
});

// ---------------------------------------------------------------- E-13
test("[E-13] a site switching its own dark theme later is re-detected", async () => {
  const page = await newPage("/e13-toggle");
  await settle(page);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await waitThemed(page, false);
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await waitThemed(page, true);
});

// ---------------------------------------------------------------- E-19
test("[E-19] light text-shadow halos are dropped on dark themes, dark ones kept", async () => {
  const page = await newPage("/b05-shadow");
  await settle(page);
  assert.equal(await colorOf(page, "#halo", "textShadow"), "none");
  assert.notEqual(await colorOf(page, "#dark", "textShadow"), "none");
});
