import express from "express";
import { JSDOM } from "jsdom";

const app = express();
const PORT = 3000;

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  next();
});

const UA = {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  },
};

function cleanText(text = "") {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function makeAbsolute(base, raw = "") {
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) return `${base}${raw}`;
  return "";
}

function uniqueByLink(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item.link || seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
}

function pickImageFromElement(el, base) {
  if (!el) return null;

  const candidates = [
    el.getAttribute("src"),
    el.getAttribute("data-src"),
    el.getAttribute("data-original"),
    el.getAttribute("data-lazy-src"),
    el.getAttribute("srcset")?.split(",")?.[0]?.trim()?.split(" ")?.[0],
    el.getAttribute("data-srcset")?.split(",")?.[0]?.trim()?.split(" ")?.[0],
  ].filter(Boolean);

  const img = candidates[0];
  return img ? makeAbsolute(base, img) : null;
}

function extractOgImage(doc) {
  return (
    doc.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
    doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content") ||
    null
  );
}

function extractPublicoLiveText(doc) {
  const article =
    doc.querySelector("article") ||
    doc.querySelector('[class*="story"]') ||
    doc.querySelector("main");

  if (!article) return "";

  const container =
    article.querySelector("#live-highlights") ||
    article.querySelector(".story__live-highlights") ||
    article.querySelector(".module--live-highlights");

  if (!container) return "";

  const items = [
    ...container.querySelectorAll(".live-highlights__item"),
  ];

  if (!items.length) return "";

  const lines = [];

  for (const item of items) {
    const time = cleanText(
      item.querySelector(".kicker")?.textContent ||
      item.querySelector("time")?.textContent ||
      ""
    );

    const headline = cleanText(
      item.querySelector(".headline")?.textContent ||
      item.querySelector("h5")?.textContent ||
      item.querySelector("a")?.textContent ||
      ""
    );

    if (headline && headline.length > 15) {
      lines.push(time ? `${time} — ${headline}` : headline);
    }
  }

  return lines.slice(0, 15).join("\n").trim();
}

function extractPublicoBody(doc) {
  const selectors = [
    '[class*="article__body"]',
    '[class*="story__body"]',
    '[class*="article-body"]',
    '[class*="story-body"]',
    "article",
    "main",
  ];

  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (!el) continue;

    const text = cleanText(el.textContent || "");
    if (text.length > 80) return text;
  }

  return "";
}

function extractJnBody(doc) {
  const selectors = [
    '[class*="article-body"]',
    '[class*="ArticleBody"]',
    '[class*="article__body"]',
    "article",
    "main",
  ];

  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (!el) continue;

    const text = cleanText(el.textContent || "");
    if (text.length > 80) return text;
  }

  return "";
}

// ─────────────────────────────────────────────────────────────
// JN LIST
// ─────────────────────────────────────────────────────────────
app.get("/jn", async (_req, res) => {
  try {
    const r = await fetch("https://www.jn.pt/", UA);
    const html = await r.text();

    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const out = [];

    doc.querySelectorAll("article").forEach((a) => {
      const title = cleanText(a.querySelector("h1, h2, h3")?.textContent || "");
      const rawLink = a.querySelector("a[href]")?.getAttribute("href") || "";
      const link = makeAbsolute("https://www.jn.pt", rawLink);
      const image = pickImageFromElement(a.querySelector("img"), "https://www.jn.pt");

      const exclusive =
        !!a.querySelector('[class*="exclusive"]') ||
        !!a.querySelector('[class*="Exclusive"]') ||
        /exclusivo/i.test(a.textContent || "");

      if (title && link) {
        out.push({ title, link, image, exclusive });
      }
    });

    res.json(uniqueByLink(out).slice(0, 8));
  } catch (err) {
    console.error("JN list error:", err);
    res.status(500).json({ error: "JN list error" });
  }
});

// ─────────────────────────────────────────────────────────────
// JN ARTICLE
// ─────────────────────────────────────────────────────────────
app.get("/jn/article", async (req, res) => {
  const url = String(req.query.url || "");

  if (!url.startsWith("https://www.jn.pt/")) {
    return res.status(400).json({ text: "" });
  }

  try {
    const r = await fetch(url, UA);
    const html = await r.text();

    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const text = extractJnBody(doc);
    res.json({ text });
  } catch (err) {
    console.error("JN article error:", err);
    res.json({ text: "" });
  }
});

// ─────────────────────────────────────────────────────────────
// PÚBLICO LIST
// ─────────────────────────────────────────────────────────────
app.get("/publico", async (_req, res) => {
  try {
    const r = await fetch("https://www.publico.pt/", UA);
    const html = await r.text();

    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const raw = [];

    doc.querySelectorAll("article").forEach((a) => {
      const title = cleanText(a.querySelector("h1, h2, h3")?.textContent || "");
      const rawLink = a.querySelector("a[href]")?.getAttribute("href") || "";
      const link = makeAbsolute("https://www.publico.pt", rawLink);

      if (title && link) {
        raw.push({ title, link });
      }
    });

    const top = uniqueByLink(raw).slice(0, 8);

    const articles = await Promise.all(
      top.map(async (item) => {
        try {
          const rr = await fetch(item.link, UA);
          const articleHtml = await rr.text();
          const articleDoc = new JSDOM(articleHtml).window.document;
          const image = extractOgImage(articleDoc);
          const storyHeader =
            articleDoc.querySelector('[class*="story-header"]') ??
            articleDoc.querySelector('[class*="story__header"]');
          const exclusive = !!storyHeader?.querySelector('.kicker--exclusive');
          return { ...item, image, exclusive };
        } catch {
          return { ...item, image: null, exclusive: false };
        }
      })
    );

    res.json(articles);
  } catch (err) {
    console.error("Publico list error:", err);
    res.status(500).json({ error: "Publico list error" });
  }
});

// ─────────────────────────────────────────────────────────────
// PÚBLICO ARTICLE (normal + em atualização)
// ─────────────────────────────────────────────────────────────
app.get("/publico/article", async (req, res) => {
  const url = String(req.query.url || "");

  if (!url.startsWith("https://www.publico.pt/")) {
    return res.status(400).json({ text: "", mode: "invalid" });
  }

  try {
    const r = await fetch(url, UA);
    const html = await r.text();

    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const liveText = extractPublicoLiveText(doc);
    if (liveText.length > 0) {
      return res.json({
        text: liveText,
        mode: "live",
      });
    }

    const bodyText = extractPublicoBody(doc);

    return res.json({
      text: bodyText,
      mode: "article",
    });
  } catch (err) {
    console.error("Publico article error:", err);
    res.json({ text: "", mode: "error" });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy running at http://localhost:${PORT}`);
});