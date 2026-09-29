#!/usr/bin/env node
/**
 * 本地验证服务（仅开发用，不随 dist 部署）：
 * - /mcp   → functions/mcp.js 的 onRequest（Node 22 原生 Request/Response）
 * - 其他   → dist/index.html
 * 用法：node scripts/dev.mjs [port]   （默认 8787）
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.argv[2] || 8787);

const { onRequest } = await import(join(ROOT, "functions", "mcp.js"));

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);

    const webReq = new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
    });

    if (req.url.startsWith("/mcp")) {
      const webRes = await onRequest({ request: webReq });
      res.writeHead(webRes.status, Object.fromEntries(webRes.headers));
      const buf = Buffer.from(await webRes.arrayBuffer());
      res.end(buf);
      return;
    }

    // 静态落地页
    if (req.url === "/" || req.url === "/index.html") {
      try {
        const html = readFileSync(join(ROOT, "dist", "index.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        res.writeHead(404); res.end("dist/index.html 不存在，请先运行 npm run build");
      }
      return;
    }
    res.writeHead(404); res.end("Not Found");
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e) }));
  }
});

server.listen(PORT, () => console.log(`dev server: http://localhost:${PORT}/mcp`));
