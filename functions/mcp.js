/**
 * rev-skills-android MCP Server（EdgeOne Pages Functions）
 *
 * - 零依赖实现 MCP Streamable HTTP（JSON 响应模式，无 SSE 会话）
 * - 路由：functions/mcp.js → https://<host>/mcp
 * - 内容模块 functions/_content.js 由 scripts/build.mjs 生成
 *
 * 工具：list_skills / read_skill / search_skills
 * 资源：skill://<name>/SKILL.md 与 skill://<name>/references/<file>.md
 */
import { SERVER, BUILD_INFO, SKILLS } from "./_content.js";

/** 支持的 MCP 协议版本（取客户端请求版本，未支持则回落最新） */
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL = PROTOCOL_VERSIONS[0];

// ---------------------------------------------------------------------------
// 内容查询
// ---------------------------------------------------------------------------

const findSkill = (name) => SKILLS.find((s) => s.name === name);

/** 规范化 reference 参数 → 在该 skill 的文件列表中查找（默认 SKILL.md） */
function resolveFile(skill, reference) {
  if (!reference || reference === "SKILL.md" || reference === "") {
    return skill.files.find((f) => f.path === "SKILL.md");
  }
  const clean = String(reference).replace(/^\/+/, "");
  const candidates = [
    clean,
    clean.replace(/\.md$/i, "") + ".md",
    clean.startsWith("references/") ? clean : `references/${clean}`,
  ].map((c) => c.replace(/\.md\.md$/i, ".md"));
  for (const c of candidates) {
    const hit = skill.files.find((f) => f.path.toLowerCase() === c.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/** 全部文件平铺（资源列表用） */
function* allFiles() {
  for (const s of SKILLS) for (const f of s.files) yield { skill: s, file: f };
}

// ---------------------------------------------------------------------------
// 工具实现（返回 { content, isError? }）
// ---------------------------------------------------------------------------

const text = (t) => ({ content: [{ type: "text", text: t }] });
const textErr = (t) => ({ content: [{ type: "text", text: t }], isError: true });

function toolListSkills() {
  const lines = SKILLS.map((s) => {
    const refs = s.references.length ? `｜references: ${s.references.join(", ")}` : "";
    return `- **${s.name}**（${s.type}）— ${s.title}\n  ${s.summary}${refs}`;
  });
  const body = [
    `# rev-skills-android — ${SKILLS.length} 个 skills（构建于 ${BUILD_INFO.builtAt.slice(0, 10)}）`,
    "",
    ...lines,
    "",
    `阅读正文用 read_skill（skill 参数取上方名称）；检索用 search_skills。`,
    `网关技能 re-mobile 是总入口，适合从任务视角选择子技能。`,
  ].join("\n");
  return text(body);
}

function toolReadSkill(args) {
  const name = String(args?.skill ?? "").trim();
  if (!name) {
    return textErr(`缺少必填参数 skill。可用值：${SKILLS.map((s) => s.name).join(", ")}`);
  }
  const skill = findSkill(name);
  if (!skill) {
    return textErr(`未找到 skill「${name}」。可用值：\n${SKILLS.map((s) => `- ${s.name}: ${s.title}`).join("\n")}`);
  }
  const refArg = args?.reference ? String(args.reference) : "SKILL.md";
  const file = resolveFile(skill, refArg);
  if (!file) {
    return textErr(
      `skill「${name}」中不存在文件「${refArg}」。可用文件：\n` +
        skill.files.map((f) => `- ${f.path}`).join("\n")
    );
  }
  return text(file.content);
}

/** 简易全文检索：关键词 AND 匹配 + 上下文片段，按命中数排序 */
function toolSearchSkills(args) {
  const query = String(args?.query ?? "").trim();
  if (!query) return textErr("缺少必填参数 query（支持空格分隔的多关键词，AND 语义）");
  const scope = args?.skill ? String(args.skill) : null;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];

  for (const { skill, file } of allFiles()) {
    if (scope && skill.name !== scope) continue;
    const content = file.content;
    const lower = content.toLowerCase();
    let score = 0;
    const misses = [];
    for (const term of terms) {
      let idx = 0, count = 0, first = -1;
      while ((idx = lower.indexOf(term, idx)) !== -1) {
        if (first === -1) first = idx;
        count++; idx += term.length;
        if (count >= 50) break;
      }
      if (count > 0) score += count * term.length; else misses.push(term);
    }
    if (misses.length || score === 0) continue;

    // 提取首个命中位置的上下文片段
    const firstTerm = terms.find((t) => lower.includes(t));
    const pos = lower.indexOf(firstTerm);
    const start = Math.max(0, content.lastIndexOf("\n", Math.max(0, pos - 120)));
    const snippet = content.slice(start, pos + 240).replace(/\s+/g, " ").trim();
    results.push({ skill: skill.name, file: file.path, score, snippet: `…${snippet}…` });
  }
  results.sort((a, b) => b.score - a.score);

  if (!results.length) {
    return text(`未检索到与「${query}」匹配的内容。建议换关键词，或用 list_skills 查看全部 skills。`);
  }
  const top = results.slice(0, 8);
  const body = [
    `检索「${query}」命中 ${results.length} 个文件，按相关度排序（Top ${top.length}）：`,
    "",
    ...top.map((r, i) =>
      `${i + 1}. **${r.skill}** / ${r.file}（相关度 ${r.score}）\n   ${r.snippet}\n   → 完整内容：read_skill(skill="${r.skill}", reference="${r.file}")`
    ),
  ].join("\n");
  return text(body);
}

const TOOLS = [
  {
    name: "list_skills",
    description:
      "列出 rev-skills-android 全部 skills（Android 逆向/移动安全）：名称、定位、触发词与 references 索引。开始任务前先调用。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_skill",
    description:
      "读取某个 skill 的完整 Markdown 内容（默认 SKILL.md 正文；reference 可指定 references/ 子文档）。",
    inputSchema: {
      type: "object",
      properties: {
        skill: {
          type: "string",
          enum: SKILLS.map((s) => s.name),
          description: "skill 名称",
        },
        reference: {
          type: "string",
          description: "可选。要读取的文件，如 SKILL.md（默认）或 references/commands.md",
        },
      },
      required: ["skill"],
    },
  },
  {
    name: "search_skills",
    description:
      "跨全部 skills 的全文检索（关键词 AND 匹配，返回相关片段与文件定位）。想确认「某话题在哪个 skill」时使用。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索词，空格分隔多关键词（AND 语义）" },
        skill: {
          type: "string",
          enum: SKILLS.map((s) => s.name),
          description: "可选。仅在指定 skill 范围内检索",
        },
      },
      required: ["query"],
    },
  },
];

// ---------------------------------------------------------------------------
// 资源（MCP resources）：每个 markdown 文件一个 resource
// ---------------------------------------------------------------------------

function resourceList() {
  const resources = [];
  for (const { skill, file } of allFiles()) {
    resources.push({
      uri: `skill://${skill.name}/${file.path}`,
      name: file.path === "SKILL.md" ? `${skill.name} — ${skill.title}` : `${skill.name} / ${file.path}`,
      title: file.path === "SKILL.md" ? skill.title : file.path,
      description: file.path === "SKILL.md" ? skill.summary : `${skill.name} 的参考资料`,
      mimeType: "text/markdown",
      size: Buffer.byteLength(file.content, "utf8"),
    });
  }
  return resources;
}

function resourceRead(uri) {
  const m = String(uri).match(/^skill:\/\/([^/]+)\/(.+)$/);
  if (!m) throw new Error(`不支持的资源 URI：${uri}（应为 skill://<skill>/<file>）`);
  const skill = findSkill(decodeURIComponent(m[1]));
  if (!skill) throw new Error(`未找到 skill「${m[1]}」`);
  const file = resolveFile(skill, decodeURIComponent(m[2]));
  if (!file) throw new Error(`skill「${skill.name}」中不存在文件「${m[2]}」`);
  return [{ uri, mimeType: "text/markdown", text: file.content }];
}

// ---------------------------------------------------------------------------
// JSON-RPC 分发
// ---------------------------------------------------------------------------

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function dispatch(msg) {
  const { id, method, params } = msg ?? {};
  const hasId = id !== undefined && id !== null;

  // 通知类消息：无需响应
  if (!hasId) return null;

  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      const version = PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL;
      return ok(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
        serverInfo: { name: SERVER.name, version: SERVER.version },
        instructions:
          "Android 逆向与移动安全知识库（11 个 skills）。先 list_skills 总览，任务匹配到哪个 skill 就 read_skill 读取全文再执行；" +
          "细节问题可用 search_skills 全文检索。references 子文档包含命令清单、决策树与踩坑经验。",
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      try {
        if (name === "list_skills") return ok(id, toolListSkills());
        if (name === "read_skill") return ok(id, toolReadSkill(args));
        if (name === "search_skills") return ok(id, toolSearchSkills(args));
        return rpcError(id, -32602, `未知工具「${name}」，可用：${TOOLS.map((t) => t.name).join(", ")}`);
      } catch (e) {
        return ok(id, { result: textErr(`工具执行失败：${e?.message || e}`) });
      }
    }
    case "resources/list":
      return ok(id, { resources: resourceList() });
    case "resources/templates/list":
      return ok(id, { resourceTemplates: [] });
    case "resources/read": {
      try {
        return ok(id, { contents: resourceRead(params?.uri) });
      } catch (e) {
        return rpcError(id, -32602, e?.message || "资源读取失败");
      }
    }
    case "prompts/list":
      return ok(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP 入口（EdgeOne Pages Functions：onRequest）
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version, mcp-session-id, X-MCP-Key",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS, ...extra },
  });

export const onRequest = async ({ request }) => {
  const method = request.method.toUpperCase();

  try {
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

    // 可选鉴权：构建/运行环境设置 MCP_ACCESS_KEY 后启用（header: X-MCP-Key 或 ?key=）
    const accessKey = globalThis.MCP_ACCESS_KEY ?? "";
    if (accessKey) {
      const url = new URL(request.url);
      const provided = request.headers.get("X-MCP-Key") ?? url.searchParams.get("key") ?? "";
      if (provided !== accessKey) {
        return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, 401);
      }
    }

    // GET：本实现为无状态 JSON 模式，不支持 SSE 流
    if (method === "GET") {
      const accept = request.headers.get("accept") ?? "";
      if (accept.includes("text/event-stream")) {
        return new Response("SSE streaming not supported (stateless JSON mode)", {
          status: 405, headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      return json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Method Not Allowed. Use POST /mcp" } }, 405);
    }

    if (method === "DELETE") return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Unsupported Media Type" } }, 415);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error: invalid JSON" } }, 400);
    }

    // 批量请求（数组）逐条分发
    const messages = Array.isArray(payload) ? payload : [payload];
    const replies = [];
    for (const msg of messages) {
      const reply = await dispatch(msg);
      if (reply) replies.push(reply);
    }

    if (!replies.length) return new Response(null, { status: 202, headers: CORS_HEADERS });
    const body = Array.isArray(payload) ? replies : replies[0];
    return json(body);
  } catch (e) {
    console.error("MCP handler error:", e);
    return json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Internal server error" } }, 500);
  }
};
