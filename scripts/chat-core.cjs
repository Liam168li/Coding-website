const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const MAX_HISTORY_MESSAGES = 6;
const MAX_CONTEXT_CHARS = 6500;
const DEFAULT_MAX_OUTPUT_TOKENS = 384;
const DEFAULT_RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60 * 1000;

const requestsByClient = new Map();
let cachedPages = null;

loadLocalEnv();

const topicTerms = new Set([
  "algorithm", "array", "assignment", "bool", "boolean", "char", "cin", "clion",
  "code", "coding", "compiler", "cout", "c++", "cpp", "debug", "double", "else",
  "exercise", "flowchart", "for", "function", "getline", "if", "input", "int",
  "iostream", "lesson", "loop", "module", "notes", "onlinegdb", "output", "problem",
  "program", "programming", "return", "score", "setup", "source", "string", "student",
  "variable", "visual", "void", "while"
]);

const stopWords = new Set([
  "a", "about", "am", "an", "and", "are", "as", "ask", "at", "be", "but", "by",
  "can", "did", "do", "does", "for", "from", "give", "had", "has", "have", "how",
  "i", "in", "is", "it", "me", "my", "of", "on", "or", "please", "show", "so",
  "tell", "that", "the", "this", "to", "use", "was", "what", "when", "where",
  "which", "who", "why", "will", "with", "would", "you", "your"
]);

function getChatConfig() {
  return {
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    maxOutputTokens: clampNumber(process.env.CHAT_MAX_OUTPUT_TOKENS, 120, 1024, DEFAULT_MAX_OUTPUT_TOKENS),
    temperature: clampNumber(process.env.CHAT_TEMPERATURE, 0, 1, 0.2),
    rateLimitPerMinute: clampNumber(process.env.CHAT_RATE_LIMIT_PER_MINUTE, 1, 60, DEFAULT_RATE_LIMIT),
  };
}

async function handleChatRequest({ body, clientId = "unknown", root = process.cwd() }) {
  const config = getChatConfig();
  const rateLimited = checkRateLimit(clientId, config.rateLimitPerMinute);
  if (rateLimited) {
    return jsonResponse(429, {
      error: `Too many questions. Please wait ${rateLimited.retryAfterSeconds} seconds and try again.`,
    });
  }

  const question = String(body?.question || "").trim();
  const history = Array.isArray(body?.history) ? body.history.slice(-MAX_HISTORY_MESSAGES) : [];
  const currentSlug = String(body?.currentSlug || "").trim();

  if (!question) return jsonResponse(400, { error: "Please type a question first." });
  if (question.length > 420) {
    return jsonResponse(400, { error: "Please keep questions under 420 characters so the chat stays lightweight." });
  }

  const pages = loadPages(root);
  const matches = findRelevantPages(question, pages, currentSlug);
  if (!isCourseQuestion(question, matches)) {
    return jsonResponse(200, {
      answer: "I can help with Liam C++ course lessons, examples, setup, exercises, and beginner C++ code. Please ask something related to the website material.",
      sources: [],
      skippedModel: true,
    });
  }

  if (!hasGeminiApiKey()) {
    return jsonResponse(500, {
      error: "Gemini is not configured yet. Add GEMINI_API_KEY to your environment variables.",
    });
  }

  const prompt = buildPrompt(question, history, matches, config.maxOutputTokens);
  const answer = await callGemini(prompt, config);

  return jsonResponse(200, {
    answer,
    sources: matches.slice(0, 3).map(({ page }) => ({ title: page.title, slug: page.slug })),
  });
}

function loadPages(root) {
  if (cachedPages) return cachedPages;
  const raw = readFileSync(resolve(join(root, "data", "content.json")), "utf8");
  const parsed = JSON.parse(raw);
  cachedPages = parsed.pages.map((page) => ({
    title: page.title,
    slug: page.slug,
    description: page.description || "",
    text: cleanMarkdown(page.markdown || ""),
  }));
  return cachedPages;
}

function cleanMarkdown(markdown) {
  return markdown
    .replace(/{%[\s\S]*?%}/g, " ")
    .replace(/<figure>[\s\S]*?<\/figure>/g, " ")
    .replace(/```([\s\S]*?)```/g, " $1 ")
    .replace(/[#>*_`[\](){}\\]/g, " ")
    .replace(/&#x20;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findRelevantPages(question, pages, currentSlug) {
  const terms = tokenize(question);
  return pages
    .map((page) => {
      const haystack = `${page.title} ${page.description} ${page.text}`.toLowerCase();
      const score = terms.reduce((total, term) => {
        if (!haystack.includes(term)) return total;
        const titleBoost = page.title.toLowerCase().includes(term) ? 3 : 1;
        return total + titleBoost;
      }, page.slug === currentSlug ? 4 : 0);
      return { page, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function isCourseQuestion(question, matches) {
  const terms = tokenize(question);
  const hasCourseTerm = terms.some((term) => topicTerms.has(term));
  const hasUsefulMatch = matches.some((match) => match.score >= 2);
  return hasCourseTerm || hasUsefulMatch;
}

function buildPrompt(question, history, matches, maxOutputTokens) {
  const context = matches
    .map(({ page }, index) => {
      const text = `${page.title}\n${page.description}\n${page.text}`.slice(0, Math.floor(MAX_CONTEXT_CHARS / Math.max(matches.length, 1)));
      return `Source ${index + 1}: ${page.title} (${page.slug})\n${text}`;
    })
    .join("\n\n");

  const conversation = history
    .map((item) => `${item.role === "assistant" ? "Assistant" : "Student"}: ${String(item.content || "").slice(0, 500)}`)
    .join("\n");

  return [
    "You are the Liam C++ course assistant for a beginner programming website.",
    "Only answer questions about the website's lessons, setup instructions, exercises, assignments, examples, or beginner C++ concepts directly connected to this course.",
    "Use the supplied course context first. If the context does not contain the answer, say what the course covers and give a short beginner-safe explanation only when it is directly related to C++ or the course.",
    "If the student asks about unrelated topics, politely refuse in one sentence and invite a course-related C++ question.",
    `Keep the answer concise, friendly, and under about ${Math.max(80, Math.round(maxOutputTokens * 0.7))} words. Do not invent links or claim to see images.`,
    "",
    "Recent chat:",
    conversation || "No previous messages.",
    "",
    "Course context:",
    context || "No matching course context found.",
    "",
    `Student question: ${question}`
  ].join("\n");
}

async function callGemini(prompt, config) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: config.maxOutputTokens,
        temperature: config.temperature,
        topP: 0.8,
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || "Gemini request failed.";
    throw new Error(message);
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  return text || "I could not generate an answer this time. Please try again with a course-related question.";
}

function checkRateLimit(clientId, limit) {
  const now = Date.now();
  const records = (requestsByClient.get(clientId) || []).filter((time) => now - time < RATE_WINDOW_MS);
  if (records.length >= limit) {
    const retryAfterSeconds = Math.ceil((RATE_WINDOW_MS - (now - records[0])) / 1000);
    requestsByClient.set(clientId, records);
    return { retryAfterSeconds };
  }
  records.push(now);
  requestsByClient.set(clientId, records);
  return null;
}

function tokenize(value) {
  return String(value)
    .toLowerCase()
    .replace(/\+\+/g, "++")
    .split(/[^a-z0-9+#]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !stopWords.has(term));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function hasGeminiApiKey() {
  const key = String(process.env.GEMINI_API_KEY || "").trim();
  return key && key !== "put_your_gemini_api_key_here" && key !== "your_gemini_api_key_here";
}

function loadLocalEnv() {
  try {
    require("dotenv").config();
  } catch {
    loadFallbackEnv(process.cwd());
  }
}

function loadFallbackEnv(root) {
  try {
    const raw = readFileSync(resolve(join(root, ".env")), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // Environment variables are optional until chat is configured.
  }
}

function jsonResponse(status, body) {
  return { status, body };
}

module.exports = { handleChatRequest };
