import { chromium, devices } from "@playwright/test";
const b = await chromium.launch();
const c = await b.newContext({ ...devices["iPhone 15"] });
const p = await c.newPage();
await p.goto("http://127.0.0.1:5199/#/", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
const info = await p.evaluate(() => {
  const main = document.querySelector(".app-scroll");
  const app = document.querySelector(".app");
  const cs = main ? getComputedStyle(main) : null;
  return {
    docScrollH: document.documentElement.scrollHeight,
    bodyScrollH: document.body.scrollHeight,
    innerH: window.innerHeight,
    mainClientH: main?.clientHeight,
    mainScrollH: main?.scrollHeight,
    overflowY: cs?.overflowY,
    appH: app?.getBoundingClientRect().height,
    cards: document.querySelectorAll(".card").length,
    lastCardBottom: (() => { const cards = document.querySelectorAll(".app-scroll .card"); const last = cards[cards.length-1]; return last ? Math.round(last.getBoundingClientRect().bottom) : null; })(),
  };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
