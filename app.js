const state = {
  pages: [],
  assets: {},
  currentIndex: 0,
};

const sourceRoot = "https://liam-2.gitbook.io/liam";

const nav = document.querySelector("#nav");
const content = document.querySelector("#content");
const pager = document.querySelector("#pager");
const searchInput = document.querySelector("#searchInput");
const currentTitle = document.querySelector("#currentTitle");
const sectionLabel = document.querySelector("#sectionLabel");
const progressBar = document.querySelector("#progressBar");
const menuButton = document.querySelector("#menuButton");
const themeToggle = document.querySelector("#themeToggle");
const breadcrumb = document.querySelector("#breadcrumb");
const lessonTabs = document.querySelector("#lessonTabs");
const lessonCounter = document.querySelector("#lessonCounter");
const coursePercent = document.querySelector("#coursePercent");
const courseProgressFill = document.querySelector("#courseProgressFill");
const outline = document.querySelector("#outline");

init();

async function init() {
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme !== "light") document.documentElement.classList.add("dark");
  themeToggle.textContent = document.documentElement.classList.contains("dark") ? "Light" : "Dark";

  const { contentData, imageAssets } = await loadCourseData();

  state.pages = contentData.pages;
  state.assets = imageAssets;

  renderNav();
  openFromHash();
  bindEvents();
}

async function loadCourseData() {
  if (window.LIAM_CONTENT) {
    return {
      contentData: window.LIAM_CONTENT,
      imageAssets: window.LIAM_IMAGE_ASSETS || {},
    };
  }

  const [contentData, imageAssets] = await Promise.all([
    fetch("data/content.json").then((response) => response.json()),
    fetch("data/image-assets.json").then((response) => response.json()).catch(() => ({})),
  ]);

  return { contentData, imageAssets };
}

function bindEvents() {
  window.addEventListener("hashchange", openFromHash);
  window.addEventListener("scroll", updateProgress, { passive: true });

  searchInput.addEventListener("input", () => renderNav(searchInput.value));
  menuButton.addEventListener("click", () => document.body.classList.toggle("menu-open"));

  themeToggle.addEventListener("click", () => {
    document.documentElement.classList.toggle("dark");
    const isDark = document.documentElement.classList.contains("dark");
    localStorage.setItem("theme", isDark ? "dark" : "light");
    themeToggle.textContent = isDark ? "Light" : "Dark";
  });

  content.addEventListener("click", async (event) => {
    const button = event.target.closest(".copy-code");
    if (!button) return;

    const code = button.closest(".code-block")?.querySelector("code")?.textContent || "";
    await copyText(code);
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy";
    }, 1400);
  });

  outline.addEventListener("click", (event) => {
    const link = event.target.closest("[data-outline-target]");
    if (!link) return;
    event.preventDefault();
    document.getElementById(link.dataset.outlineTarget)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function openFromHash() {
  const slug = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  const index = state.pages.findIndex((page) => page.slug === slug);
  openPage(index === -1 ? 0 : index);
}

function openPage(index) {
  state.currentIndex = index;
  const page = state.pages[index];
  content.classList.remove("content-enter");
  currentTitle.textContent = page.title;
  sectionLabel.textContent = groupTitle(page.slug);
  breadcrumb.textContent = `${groupTitle(page.slug)} / ${page.title}`;
  document.title = `${page.title} | Liam C++ Course`;
  content.innerHTML = markdownToHtml(page.markdown);
  requestAnimationFrame(() => content.classList.add("content-enter"));
  renderNav(searchInput.value);
  renderLessonTabs(page);
  renderOutline();
  renderCourseProgress(page);
  renderPager();
  updateProgress();
  document.body.classList.remove("menu-open");
  window.scrollTo({ top: 0, behavior: "instant" });
}

function renderLessonTabs(page) {
  const root = page.slug.split("/")[0];
  const candidates = [
    { label: "Lesson", test: (slug) => slug.startsWith(`${root}/intro-`) },
    { label: "Slides", slug: `${root}/presentations` },
    { label: "Notes", slug: `${root}/notes` },
    { label: "Code", slug: `${root}/source-code` },
    { label: "Exercise", slug: `${root}/exercise` },
    { label: "Assignment", slug: `${root}/assignment` },
  ];

  const tabs = candidates
    .map((candidate) => {
      const index = candidate.slug
        ? state.pages.findIndex((item) => item.slug === candidate.slug)
        : state.pages.findIndex((item) => candidate.test(item.slug));
      if (index === -1) return null;
      return { label: candidate.label, page: state.pages[index] };
    })
    .filter(Boolean);

  lessonTabs.innerHTML = tabs
    .map((tab) => {
      const isActive = page.slug === tab.page.slug || page.slug.startsWith(`${tab.page.slug}/`);
      return `<a class="${isActive ? "active" : ""}" href="#/${tab.page.slug}">${escapeHtml(tab.label)}</a>`;
    })
    .join("");
}

function renderOutline() {
  const headings = [...content.querySelectorAll("h2, h3")];

  headings.forEach((heading) => {
    if (!heading.id) heading.id = slugify(heading.textContent);
  });

  outline.classList.toggle("is-empty", headings.length === 0);
  outline.innerHTML = headings.length
    ? `<h2>On this page</h2>${headings
      .map((heading) => `<a class="level-${heading.tagName.toLowerCase()}" href="" data-outline-target="${heading.id}">${escapeHtml(heading.textContent)}</a>`)
      .join("")}`
    : "";
}

function renderCourseProgress(page) {
  const percent = Math.round(((state.currentIndex + 1) / state.pages.length) * 100);
  coursePercent.textContent = `${percent}%`;
  courseProgressFill.style.width = `${percent}%`;

  const group = groupTitle(page.slug);
  const groupPages = state.pages.filter((item) => groupTitle(item.slug) === group);
  const localIndex = groupPages.findIndex((item) => item.slug === page.slug);
  lessonCounter.textContent = `${localIndex + 1} / ${groupPages.length}`;
}

function renderNav(query = "") {
  const groups = new Map();
  const normalizedQuery = query.trim().toLowerCase();
  const visibleIndexes = new Set();

  state.pages.forEach((page, index) => {
    const haystack = `${page.title} ${page.description} ${page.markdown}`.toLowerCase();
    if (normalizedQuery && !haystack.includes(normalizedQuery)) {
      return;
    }

    visibleIndexes.add(index);

    const parentIndex = answerParentIndex(page.slug);
    if (parentIndex !== -1) visibleIndexes.add(parentIndex);
  });

  state.pages.forEach((page, index) => {
    if (!visibleIndexes.has(index)) return;
    if (answerParentIndex(page.slug) !== -1) return;

    const title = groupTitle(page.slug);
    if (!groups.has(title)) groups.set(title, []);

    const children = state.pages
      .map((childPage, childIndex) => ({ page: childPage, index: childIndex }))
      .filter(({ page: childPage, index: childIndex }) => {
        return visibleIndexes.has(childIndex) && answerParentIndex(childPage.slug) === index;
      });

    groups.get(title).push({ page, index, children });
  });

  nav.innerHTML = [...groups.entries()]
    .map(([title, items]) => `
      <section class="nav-group">
        <h2 class="nav-heading">${escapeHtml(title)}</h2>
        ${items.map(({ page, index, children }) => `
          <a class="nav-link ${index === state.currentIndex ? "active" : ""} ${children.length ? "has-children" : ""}" href="#/${page.slug}">
            ${escapeHtml(page.title)}
          </a>
          ${children.length ? `
            <div class="nav-children">
              ${children.map(({ page: childPage, index: childIndex }) => `
                <a class="nav-link nav-link-child ${childIndex === state.currentIndex ? "active" : ""}" href="#/${childPage.slug}">
                  ${escapeHtml(childPage.title)}
                </a>
              `).join("")}
            </div>
          ` : ""}
        `).join("")}
      </section>
    `)
    .join("") || `<p class="loading">No lessons found.</p>`;
}

function answerParentIndex(slug) {
  if (!/(^|\/)(answer|sample-answer)$/.test(slug)) return -1;
  const parentSlug = slug.replace(/\/(answer|sample-answer)$/, "");
  return state.pages.findIndex((page) => page.slug === parentSlug);
}

function renderPager() {
  const prev = state.pages[state.currentIndex - 1];
  const next = state.pages[state.currentIndex + 1];

  pager.innerHTML = `
    ${prev ? `<a href="#/${prev.slug}"><span>Previous</span><strong>${escapeHtml(prev.title)}</strong></a>` : "<div></div>"}
    ${next ? `<a href="#/${next.slug}"><span>Next</span><strong>${escapeHtml(next.title)}</strong></a>` : "<div></div>"}
  `;
}

function updateProgress() {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollable <= 0 ? 0 : (window.scrollY / scrollable) * 100;
  progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
}

function groupTitle(slug) {
  if (!slug.includes("/")) return "Start Here";
  const [first] = slug.split("/");
  if (first === "how-to-begin-with-c++") return "Setup";
  if (first.startsWith("module-")) return `Module ${first.replace("module-", "")}`;
  return titleCase(first.replaceAll("-", " "));
}

function markdownToHtml(markdown) {
  const normalized = markdown
    .replaceAll("&#x20;", "")
    .replace(/<figure>\s*<img src="([^"]+)" alt="([^"]*)">\s*<figcaption>[\s\S]*?<\/figcaption>\s*<\/figure>/g, (_, src, alt) => {
      return `\n\n![${alt || "Course image"}](${resolveAsset(src)})\n\n`;
    })
    .replace(/{% embed url="<([^>]+)>" %}/g, (_, url) => embedCard(url))
    .replace(/{% file src="([^"]+)" %}/g, (_, src) => fileCard(src))
    .replace(/{% hint style="([^"]+)" %}\n?([\s\S]*?)\n?{% endhint %}/g, (_, style, body) => {
      return `\n\n<div class="hint"><strong>${escapeHtml(titleCase(style))}</strong>${markdownToHtml(body)}</div>\n\n`;
    })
    .replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_, code) => {
      return `\n\n\`\`\`\n${decodeHtml(code.replace(/<\/?strong>/g, ""))}\n\`\`\`\n\n`;
    });

  const blocks = [];
  const codeStore = [];
  const text = normalized.replace(/```([\s\S]*?)```/g, (_, code) => {
    const token = `@@CODE${codeStore.length}@@`;
    codeStore.push(codeBlock(code.trim()));
    return token;
  });

  const lines = text.split(/\n/);
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${inlineFormat(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    blocks.push(`<${list.type}>${list.items.map((item) => `<li>${inlineFormat(item)}</li>`).join("")}</${list.type}>`);
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith("@@CODE")) {
      flushParagraph();
      flushList();
      blocks.push(codeStore[Number(line.match(/\d+/)[0])]);
      continue;
    }

    if (line.startsWith("<div class=\"")) {
      flushParagraph();
      flushList();
      blocks.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${inlineFormat(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\*{3,}$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push("<hr>");
      continue;
    }

    const unordered = line.match(/^\*\s+(.+)$/);
    const ordered = line.match(/^\d+\\?\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const type = unordered ? "ul" : "ol";
      if (!list || list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push((unordered || ordered)[1]);
      continue;
    }

    paragraph.push(line.replace(/\\$/, ""));
  }

  flushParagraph();
  flushList();

  return blocks.join("\n");
}

function inlineFormat(value) {
  let output = escapeHtml(decodeHtml(value));
  output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  output = output.replace(/&lt;(https?:\/\/[^&]+)&gt;/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>');
  return output;
}

async function copyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (copied) return;

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

function codeBlock(code) {
  return `
    <div class="code-block">
      <div class="code-meta">
        <span>C++</span>
        <button class="copy-code" type="button" aria-label="Copy code block">Copy</button>
      </div>
      <pre><code>${escapeHtml(code)}</code></pre>
    </div>
  `;
}

function resolveAsset(src) {
  if (state.assets[src]) return state.assets[src].path;
  if (src.startsWith("/files/")) return `${sourceRoot}${src}`;
  return src;
}

function embedCard(url) {
  if (url.includes("docs.google.com/presentation/")) {
    const embedUrl = googleSlidesEmbedUrl(url);
    return `<div class="slide-embed"><iframe src="${escapeHtml(embedUrl)}" title="Embedded Google Slides" allowfullscreen></iframe><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open in Google Slides</a></div>`;
  }

  if (url.includes("docs.google.com/document/")) {
    const previewUrl = googleDocPreviewUrl(url);
    const downloadUrl = googleDocDownloadUrl(url);
    return `<div class="doc-embed"><iframe src="${escapeHtml(previewUrl)}" title="Embedded class notes"></iframe><div class="embed-actions"><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open in Google Docs</a><a href="${escapeHtml(downloadUrl)}" target="_blank" rel="noreferrer">Download PDF</a></div></div>`;
  }

  const label = url.includes("document") ? "Open document" : "Open resource";
  return `<div class="embed-card"><strong>${label}</strong><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a></div>`;
}

function googleSlidesEmbedUrl(url) {
  const match = url.match(/\/presentation\/d\/([^/]+)/);
  if (!match) return url;
  return `https://docs.google.com/presentation/d/${match[1]}/embed?start=false&loop=false&delayms=3000`;
}

function googleDocPreviewUrl(url) {
  const match = url.match(/\/document\/d\/([^/]+)/);
  if (!match) return url;
  return `https://docs.google.com/document/d/${match[1]}/preview`;
}

function googleDocDownloadUrl(url) {
  const match = url.match(/\/document\/d\/([^/]+)/);
  if (!match) return url;
  return `https://docs.google.com/document/d/${match[1]}/export?format=pdf`;
}

function fileCard(src) {
  const asset = state.assets[src];
  if (asset) {
    return `<div class="file-card"><strong>Download file</strong><a href="${asset.path}" download>Open local attachment</a></div>`;
  }
  return "";
}

function titleCase(value) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "section";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeHtml(value) {
  const element = document.createElement("textarea");
  element.innerHTML = value;
  return element.value;
}
