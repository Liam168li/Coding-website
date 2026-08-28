import { mkdir, writeFile } from "node:fs/promises";

const INDEX_URL = "https://liam-2.gitbook.io/liam/llms.txt";

function slugFromUrl(url) {
  const parsed = new URL(url);
  return parsed.pathname
    .replace(/^\/liam\/?/, "")
    .replace(/\.md$/, "")
    .replace(/^$/, "please-read-before-you-started");
}

function parseIndex(text) {
  const pages = [];
  const linePattern = /^- \[(.+?)\]\((https:\/\/liam-2\.gitbook\.io\/liam\/.+?\.md)\)(?::\s*(.*))?$/gm;
  let match;

  while ((match = linePattern.exec(text)) !== null) {
    pages.push({
      title: match[1],
      url: match[2],
      description: match[3] || "",
      slug: slugFromUrl(match[2]),
    });
  }

  return pages;
}

function stripGitBookNotice(markdown) {
  return markdown
    .replace(/^> For the complete documentation index,[\s\S]*?\n\n/, "")
    .trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "LiamCourseMigration/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }

  return response.text();
}

const indexText = await fetchText(INDEX_URL);
const pages = parseIndex(indexText);

if (pages.length === 0) {
  throw new Error("No pages found in llms.txt");
}

const content = [];

for (const page of pages) {
  const markdown = stripGitBookNotice(await fetchText(page.url));
  content.push({ ...page, markdown });
  console.log(`Fetched ${page.slug}`);
}

await mkdir("data", { recursive: true });
await writeFile(
  "data/content.json",
  JSON.stringify(
    {
      source: "https://liam-2.gitbook.io/liam",
      exportedAt: new Date().toISOString(),
      pages: content,
    },
    null,
    2,
  ),
);

console.log(`Saved ${content.length} pages to data/content.json`);
