const { handleChatRequest } = require("../scripts/chat-core.cjs");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST for chat requests." });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
    const result = await handleChatRequest({
      body,
      clientId: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "vercel",
      root: process.cwd(),
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(500).json({ error: error.message || "Chat failed." });
  }
};
