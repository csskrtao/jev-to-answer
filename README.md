<div align="center">

<img src="docs/images/logo.svg" width="88" height="88" alt="答案之书 Logo" />

# 答案之书

**遇事不决，Jev 解决。**

把困惑写下来，让大模型整理可能，让 Jev 给出一个方向。

![Node.js](https://img.shields.io/badge/Node.js-22%2B-697456?style=flat-square)

![Inspired by jev_demo](https://img.shields.io/badge/Inspired_by-jev__demo-b86645?style=flat-square)

[页面预览](#页面预览) · [本地运行](#本地运行) · [配置说明](#配置说明) · [排查问题](#验证与排错)

</div>

---

答案之书是一个面向日常选择的 AI 应用。大模型负责理解问题、整理候选和生成解释，Jev 负责从候选中做出选择。每次回答都可以收藏、重读或继续追问。

本项目致敬 **`jev_demo`（Jev 调试广场）**，将原本用于调试的“需求 → 参数 → Jev 评估 → 解释”流程，变成一套可以直接面向用户使用的答案书体验。

## 功能一览

- 输入问题和背景，由大模型整理 2–4 个候选选项
- 调用 Jev 评估候选，展示选择和可用的概率分布
- 对事实、评价、闲聊等非决策问题直接回答，不强行生成选项
- 继续追问、补充条件、收藏、搜索和重读历史答案
- 六种回复风格随时切换，并可按新风格重写当前答案
- 支持 TypeSafe API 和 Vercel AI Gateway 两种 Jev 通道
- 支持浅色、深色主题；历史记录只保存在当前浏览器

## 回复风格

首页可选择温和版（默认）、毒舌版、干练版、幽默版、理性版或治愈版，浏览器会记住提问偏好。毒舌版采用直接的损友口吻，干练版突出结论和行动，理性版强调依据与取舍。

阅读答案时也可切换风格，用于后续追问和补充后的回答。仅切换不会请求模型或修改已展示内容；点击「按此风格重写」才会调用模型一次，并另存一条答案，原答案仍可回看。重写继承收藏和已有追问，但不会重写历史追问。

风格只改变直接回答、决策解读和追问的表达。决策候选保持中性；重写不会重新调用 Jev，也不会改变已有选择和概率。旧历史按温和版读取，每条答案和追问分别标注实际生成风格。重写与普通请求共用使用额度。

接口支持：`GET /api/book/styles` 返回预设风格目录；现有三个业务 POST 接口接收可选 `style` 字段，支持 `gentle`、`roast`、`concise`、`humorous`、`rational`、`healing`，省略时默认 `gentle`。`POST /api/book/rewrite` 接收 `question`、`supplements`、`options`、决策回答所需的 `decision` 和目标 `style`，返回 `{ ok, style, answer }`。

## 页面预览

![答案之书首页](docs/images/home-light.png)

![我的答案](docs/images/library.png)

<details>
<summary>查看深色主题</summary>

![深色首页](docs/images/home-dark.png)

</details>

<sub>截图展示页面视觉；部分截图来自早期版本，当前版本已移除模型设置入口。</sub>

## 本地运行

准备 **Node.js 22 或更新版本**、一个兼容 OpenAI Chat Completions 的大模型服务，以及 TypeSafe 或 Vercel AI Gateway 的 Jev 密钥。

### 1. 下载项目

在 PowerShell 中执行：

```powershell
git clone https://github.com/csskrtao/jev-to-answer.git
cd jev-to-answer
```

### 2. 安装依赖并配置模型

```powershell
npm ci
Copy-Item .env.example .env
notepad .env
```

如果已有 `.env`，直接编辑即可，不要再次复制覆盖。将文件中的占位地址、模型和密钥替换为自己的值，例如：

```dotenv
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
LLM_API_KEY=replace-with-your-llm-key
JEV_PROVIDER=typesafe
JEV_API_KEY=replace-with-your-jev-key
# 可选；不填写时使用当前通道默认值
# JEV_BASE_URL=https://api.typesafe.ai/v1
# JEV_MODEL=jev-latest
```

### 3. 启动服务

保存文件后启动：

```powershell
npm start
```

打开 [http://localhost:9001](http://localhost:9001)。开发时使用 `npm run dev`，修改 `.env` 后需要重启服务。已有系统环境变量优先于 `.env` 的同名值。需要换端口时，可先在 PowerShell 执行 `$env:PORT = '9010'`。

本地 Node.js 运行使用内存额度计数，重启后清零。模型调用费用由配置密钥的账号承担。

## 配置说明

### 大模型配置

| 变量 | 说明 |
| :--- | :--- |
| `LLM_BASE_URL` | OpenAI Chat Completions 兼容 API 的基础地址，例如 `https://api.openai.com/v1`；不要填写控制台网址或完整请求路径 |
| `LLM_MODEL` | 服务商实际支持的模型 ID |
| `LLM_API_KEY` | 大模型密钥；免鉴权服务可留空 |

大模型需要支持文本对话，并能按提示返回 JSON；项目没有要求服务商提供专门的结构化输出接口。不要在基础地址末尾添加 `/chat/completions` 或 `/responses`。服务地址必须能从运行 Node.js 后端的电脑访问。

### Jev 配置

| 变量 | TypeSafe 默认值 | Vercel 默认值 |
| :--- | :--- | :--- |
| `JEV_PROVIDER` | `typesafe` | `vercel` |
| `JEV_BASE_URL` | `https://api.typesafe.ai/v1` | `https://ai-gateway.vercel.sh/v4/ai` |
| `JEV_MODEL` | `jev-latest` | `typesafe-ai/jev` |
| `JEV_API_KEY` | TypeSafe 密钥 | Vercel Gateway 密钥 |

TypeSafe 请求会访问基础地址下的 `/systemone`，所以不要把 `/systemone` 写进 `JEV_BASE_URL`。Jev 是决策模型，不能填到 `LLM_MODEL`。

切换通道时，地址、模型和密钥需要一起切换。只有未填写 `JEV_BASE_URL`、`JEV_MODEL` 时，程序才使用对应通道的默认值。即使只测试普通问答，当前就绪检查也要求填写 Jev 密钥。

### 请求额度

| 变量 | 默认值 | 含义 |
| :--- | :--- | :--- |
| `REQUESTS_PER_MINUTE` | `12` | 每个 IP 每分钟的业务请求数 |
| `REQUESTS_PER_DAY` | `60` | 每个 IP 每日的业务请求数 |
| `GLOBAL_REQUESTS_PER_DAY` | `3000` | 全站每日业务请求数 |

每日额度按 UTC 日期重置。一次决策通常消耗两次业务请求、三次上游模型调用，普通问答消耗一次业务请求和一次模型调用；追问、重新评估和 SDK 重试也可能增加用量。通过额度检查后，即使上游调用失败，该请求仍会计数。请求额度不是回答条数或金额上限，建议同时设置上游消费上限。

## 验证与排错

先检查配置状态：

```powershell
Invoke-RestMethod -Uri 'http://localhost:9001/api/status'
```

返回 `ready: true` 只表示必要配置已填写，不代表上游密钥有效或接口连通。请在页面提交一个决策问题，验证完整调用流程；该操作会消耗模型额度。

常见问题：

| 现象 | 检查项 |
| :--- | :--- |
| `ready: false` | `LLM_BASE_URL`、`LLM_MODEL`、`JEV_API_KEY` 是否配置在当前运行环境；修改后是否重启服务 |
| 大模型调用失败 | Base URL 是否为兼容 API 基础地址；模型 ID、密钥、余额是否正确 |
| Jev 调用失败 | `JEV_PROVIDER`、地址、模型和密钥是否属于同一通道；账号是否有权限和额度 |
| `429` | 本站额度已用尽，检查三个额度变量；上游限流通常表现为业务接口调用失败 |
| `/api/config`、`/api/models` 为 404 | 这是预期行为，公开版本已关闭配置和调试接口 |

## 开发与 API

运行测试：

```powershell
npm test
```

公开 API 只有以下业务接口：

| 方法 | 路径 | 作用 |
| :--- | :--- | :--- |
| `GET` | `/api/status` | 返回服务是否已配置，不返回密钥 |
| `POST` | `/api/book/options` | 识别意图并生成候选，或直接回答非决策问题 |
| `POST` | `/api/book/decide` | 将候选交给 Jev 评估 |
| `POST` | `/api/book/follow-up` | 基于原问题和上下文继续回答 |

请求成功返回 `{ ok: true, ... }`，失败返回 `{ ok: false, error }`。配置、模型列表和旧调试 API 已关闭，访客不能通过请求覆盖服务端模型地址或密钥。

项目结构：

```text
public/              页面、交互、样式与静态资源
src/app.js           HTTP 路由与配置保护
src/book.js          决策、补充条件与追问校验
src/llm.js           大模型调用与回答生成
src/jev.js           TypeSafe / Vercel 适配
src/runtime-config.js 环境变量配置
src/quota.js         请求额度管理
server.mjs           本地 Node.js 入口
```

## 数据与安全

- 模型密钥保存在本地 `.env` 或服务端环境变量中，浏览器不会读取。`.env` 已被 Git 忽略，不要提交真实密钥。
- 答案、收藏和追问保存在当前浏览器，最多 100 条答案，每条保留最近 20 轮追问；清除站点数据会清除它们，设备间不会自动同步。
- 公开站点没有用户登录，访客共享服务端模型和请求额度规则；如需限制使用人群，应另行配置访问控制。
- 用户输入及相关上下文会发送给管理员配置的模型服务处理。概率表示候选的相对倾向，不是现实成功率；普通事实回答没有联网检索能力。

旧版本的 `data/config.json` 已不再读取。升级时需手动迁移到 `.env`，旧数据不会自动删除。

## 致敬

感谢 `jev_demo` 的启发，以及 TypeSafe / Jev、Vercel AI SDK、Cloudflare Workers 和相关开源工具。

感谢 [Linux.do](https://linux.do/) 社区成员长期以来的支持与分享。

相关资料：[TypeSafe API](https://docs.typesafe.ai/api) · [Choice 原语](https://docs.typesafe.ai/primitives/choice) · [Vercel AI Gateway](https://vercel.com/ai-gateway)

> 每一个犹豫，都值得一个答案。
