# rev-skills-android MCP

把 **11 个 Android 逆向 / 移动安全 skills**（APK 静态分析、JNI 原生库、Frida 插桩与脚本生成、加固脱壳、Flutter/RN 混合应用、加密体系审计、移动取证等）汇总为一个**远程 MCP Server**，零依赖运行在腾讯云 EdgeOne Pages Functions 上，多端（CodeBuddy / Claude / Cursor / Cherry Studio 等）按 URL 接入即可。

## Skills 清单

| Skill | 定位 |
|---|---|
| `re-mobile` | 移动应用分析网关（总入口，编排子技能） |
| `re-apk` | APK 静态分析（jadx/apktool/smali/加固识别） |
| `re-java` | Java 字节码逆向（CFR/JD-GUI/javap） |
| `re-android-native` | 原生库 JNI/.so 逆向 |
| `re-android-crypto` | 加密体系审计（AndroidKeyStore/Cipher hook） |
| `re-frida` | Frida 动态插桩 |
| `re-frida-script-author` | Frida 脚本生成方法论 |
| `re-mobile-pack` | Android 加固脱壳（DEX 恢复） |
| `re-hybrid-app` | Flutter / React Native 混合应用逆向 |
| `re-flutter` | Flutter / Dart AOT 快照逆向 |
| `re-mobile-forensics` | 移动设备取证（备份解析/数据提取） |

## MCP 接口

端点：`https://eo.suen.us.ci/mcp`（Streamable HTTP，JSON 响应模式，无状态）

**Tools**

| 工具 | 参数 | 说明 |
|---|---|---|
| `list_skills` | — | 全部 skills 总览（名称/定位/触发词/references 索引） |
| `read_skill` | `skill`（必填）、`reference`（可选，默认 `SKILL.md`） | 读取 skill 全文或 references 子文档 |
| `search_skills` | `query`（必填）、`skill`（可选限定范围） | 跨 skills 全文检索（关键词 AND，返回片段+定位） |

**Resources**：每个 markdown 文件一个资源，URI 形如 `skill://re-apk/SKILL.md`、`skill://re-apk/references/commands.md`。

**客户端配置示例**

```json
{
  "mcpServers": {
    "rev-skills-android": {
      "url": "https://eo.suen.us.ci/mcp"
    }
  }
}
```

## 项目结构

```
rev-skills-mcp/
├── skills/                 # 11 个 skills 源文件（SKILL.md + references/）
├── functions/
│   ├── mcp.js              # MCP Server（边缘函数，路由 /mcp，零依赖）
│   └── _content.js         # 构建产物：skills 内容模块（勿手改）
├── scripts/
│   ├── build.mjs           # 解析 skills → _content.js + 组装 dist/
│   └── dev.mjs             # 本地验证服务（node scripts/dev.mjs 8787）
├── index.html              # 落地页（构建时注入 skills 数据）
├── dist/                   # 部署产物（构建生成，随 dist 部署）
└── .github/workflows/deploy.yml   # push main 自动部署（GitHub Actions）
```

## 本地开发

```bash
npm run dev        # 构建 + 启动 http://localhost:8787/mcp
# 调试：
curl -s localhost:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 部署

### 方式一：CLI（一次性 / CI 外）

在 [EdgeOne Pages 控制台](https://console.tencentcloud.com/edgeone/pages) → 设置 → API Token 生成 token，然后：

```bash
npm run build
npx edgeone pages deploy ./dist -n rev-skills-android-mcp -t <EDGEONE_API_TOKEN> -a overseas
```

项目不存在会自动创建，返回部署 URL。

### 网络类型（`-a`）

本项目固定使用 **`overseas`**：全球加速，**不含中国内地**。

| 取值 | 含义 | 预设域名 |
| --- | --- | --- |
| `overseas` | 全球加速，**不含中国内地**（本项目采用） | `*.edgeone.dev` |
| `global` | 全球加速，含中国内地（CLI 默认值，不传 `-a` 时走这个） | `*.edgeone.cool` |

GitHub Actions 的 `deploy.yml` 已带上 `-a overseas`，无需额外配置。若项目此前已按 `global` 创建过，`-a` 可能沿用项目既有设置，需在 EdgeOne Pages 控制台的项目设置里改网络类型。

### ⚠️ 预设域名不能当 MCP 端点用

部署返回的 `*.edgeone.dev` / `*.edgeone.cool` 是**带时效签名的预览链接**，直接访问会返回：

```
401 UNAUTHORIZED   X-EOP-MSG: eo_time missing
```

这与网络类型无关（`overseas` 和 `global` 都一样），CLI 和 API 也没有关闭该鉴权的开关。**要给 MCP 客户端长期使用，必须绑自定义域名。**

本项目正式端点：**`https://eo.suen.us.ci/mcp`**

绑域名时在控制台「域名管理 → 添加自定义域名」，按提示加一条 CNAME 即可。选 `overseas` 的额外好处：官方文档规定「加速区域为中国内地可用区或全球（含中国内地）时，添加的域名必须先完成 ICP 备案」，**不含中国内地的区域免备案**。

### 方式二：GitHub Actions（推荐）

`.github/workflows/deploy.yml` 已就绪：push 到 `main` 分支自动构建并部署。需在仓库 **Settings → Secrets and variables → Actions** 添加 Secret：

- Name：`EDGEONE_API_TOKEN`
- Value：EdgeOne Pages API Token

### 可选：访问鉴权

默认端点公开可访问（内容为公开知识性质）。如需加一层口令，在部署环境设置环境变量 `MCP_ACCESS_KEY`，请求时携带 `X-MCP-Key` 头或 `?key=` 参数即可。

## 更新 skills

1. 增删改 `skills/` 下的目录（每个 skill 目录必须含 `SKILL.md`，可选 `references/*.md`）
2. `npm run build`（自动重新解析 frontmatter 与触发词）
3. 重新部署

> 前置 frontmatter 字段：`name`（skill 名，目录名兜底）、`description`（其中「触发词：」会解析为关键词索引）、`capabilities`（可选）。构建器对 YAML 做宽容解析，个别格式瑕疵不影响。
