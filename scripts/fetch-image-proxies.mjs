import { mkdir, readFile, writeFile } from "node:fs/promises";

const content = JSON.parse(await readFile("data/content.json", "utf8"));
const manifest = {};

function pageHtmlUrl(page) {
  return page.url.replace(/\.md$/, "");
}

function unique(items) {
  return [...new Set(items)];
}

function normalizeProxyUrl(url) {
  return url.replaceAll("\\u0026", "&").replaceAll("\\/", "/").replaceAll("&amp;", "&");
}

function imageFileIds(markdown) {
  return [...markdown.matchAll(/<figure>\s*<img src="\/files\/([A-Za-z0-9_-]+)"/g)].map(
    (match) => match[1],
  );
}

function proxyImageUrls(html) {
  const matches = [
    ...html.matchAll(/https:\/\/liam-2\.gitbook\.io\/liam\/~gitbook\/image\?[^"' <]+/g),
  ].map((match) => normalizeProxyUrl(match[0]));

  const bestByOriginal = new Map();
  for (const url of matches) {
    const parsed = new URL(url);
    const original = parsed.searchParams.get("url");
    const width = Number(parsed.searchParams.get("width") || 0);
    const dpr = Number(parsed.searchParams.get("dpr") || 1);
    const score = width * dpr;
    const current = bestByOriginal.get(original);
    if (!current || score > current.score) {
      bestByOriginal.set(original, { url, score });
    }
  }

  const urls = [...bestByOriginal.values()].map((item) => item.url);

  return unique(urls);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "LiamCourseMigration/1.0",
    },
  });

  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

await mkdir("assets/files", { recursive: true });

for (const page of content.pages) {
  const ids = imageFileIds(page.markdown);
  if (ids.length === 0) continue;

  const html = await fetchText(pageHtmlUrl(page));
  const proxies = proxyImageUrls(html);
  console.log(`${page.slug}: ${ids.length} local ids, ${proxies.length} proxy urls`);

  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    const proxy = proxies[index];
    if (!proxy) {
      console.warn(`No proxy URL for ${id}`);
      continue;
    }

    const response = await fetch(proxy, {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "user-agent": "LiamCourseMigration/1.0",
      },
    });

    if (!response.ok) {
      console.warn(`Skipped ${id}: ${response.status} ${response.statusText}`);
      continue;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const path = `assets/files/${id}.png`;
    await writeFile(path, bytes);
    manifest[`/files/${id}`] = {
      path,
      source: proxy,
      bytes: bytes.length,
    };
    console.log(`Saved ${path}`);
  }
}

await writeFile("data/image-assets.json", JSON.stringify(manifest, null, 2));
console.log(`Saved ${Object.keys(manifest).length} image assets`);
