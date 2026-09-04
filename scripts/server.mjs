import { createRequire } from "node:module";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(".");
const port = Number(process.env.PORT || 5173);
const require = createRequire(import.meta.url);
const { handleChatRequest } = require("./chat-core.cjs");

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (url.pathname === "/api/chat") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Use POST for chat requests." });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = await handleChatRequest({
        body,
        clientId: request.socket.remoteAddress || "local",
        root,
      });
      sendJson(response, result.status, result.body);
    } catch (error) {
      sendJson(response, 500, { error: error.message || "Chat failed." });
    }
    return;
  }

  const requestedPath = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  let filePath = resolve(join(root, requestedPath || "index.html"));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  if (!existsSync(filePath)) filePath = resolve(root, "index.html");
  if (statSync(filePath).isDirectory()) filePath = join(filePath, "index.html");

  response.writeHead(200, {
    "content-type": types[extname(filePath).toLowerCase()] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Liam course site running at http://127.0.0.1:${port}`);
});

function readJsonBody(request) {
  return new Promise((resolveBody, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 20_000) {
        request.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    request.on("end", () => {
      try {
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
