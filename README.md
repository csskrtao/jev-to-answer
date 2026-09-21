# 答案之书

**遇事不决，Jev 解决。**

写下一个问题，大模型把纠结整理为 2–4 个选项，Jev 从中选择一个方向，再由大模型结合真实结果提供简短解读。每条答案都能继续追问，深入了解原因、补充条件或讨论下一步。

这是一个独立项目，使用自己的依赖、配置与启动端口，不需要启动上一级的 Jev 调试广场。

## 启动

环境：Node.js 22 或更新版本，推荐当前 LTS。

在本目录打开 PowerShell：

```powershell
npm ci
npm start
```

打开 [http://localhost:9001](http://localhost:9001)。开发时可用 `npm run dev` 自动重启后端，前端修改后刷新浏览器即可。

修改端口：

```powershell
$env:PORT = '9010'
npm start
```

手机与电脑连接同一个局域网后，在手机浏览器打开 `http://电脑的局域网IP:9001`。可通过 `ipconfig` 查询电脑 IPv4 地址；需要网络和系统防火墙允许访问此端口。

## 使用

1. 在「模型设置」中填写兼容 OpenAI Chat Completions 的服务地址、模型和密钥；支持从服务端读取模型列表。
2. 选择 Jev 接入方式：TypeSafe API 或 Vercel AI Gateway，填写对应密钥。
3. 输入问题，或点击灵感卡片。页面会依次显示选项生成和 Jev 权衡进度。
4. 查看真实选择、选项分布与解读；可收藏、复制或重新提问。
5. 在答案下的「继续追问」中深入讨论。每次追问携带原问题、选项、Jev 选择和最近 6 轮对话。追问由大模型解释，不会冒充一次新的 Jev 决策。
6. 在「我的答案」中搜索、重读、继续对话或逐条删除；在「收藏的启示」中查看收藏。

历史和追问只存储在当前浏览器，最多 100 条答案，每条保留最近 20 轮追问。电脑和手机的历史独立；清除浏览器站点数据会清除这些历史。

## 配置

配置写入本项目的 `data/config.json`，已加入 `.gitignore`。本地开发时可复制旧项目配置到这里；两份配置之后各自独立。

首次使用没有配置文件时，打开设置填写即可。API 的读取和保存响应都不返回原始密钥；已配置的密钥留空会保留，程序调用可用 `clearApiKey: true` 明确清除。

| 接入              | 服务地址                             | 模型              |
| ----------------- | ------------------------------------ | ----------------- |
| TypeSafe          | `https://api.typesafe.ai/v1`         | `jev-latest`      |
| Vercel AI Gateway | `https://ai-gateway.vercel.sh/v4/ai` | `typesafe-ai/jev` |

大模型 API Key 可留空以适配本地免鉴权服务。Jev 是决策模型，使用 evaluation / systemone 接口，不能作为聊天模型填入大模型栏。

此版本供本机或可信局域网使用，配置接口没有用户鉴权。若要公开部署，应先添加访问控制、用户隔离和限流。

## 接口

| 方法与路径                 | 输入                                                | 输出                                                 |
| -------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| `GET /api/config`          | 无                                                  | 脱敏配置与 `apiKeyConfigured`                        |
| `POST /api/config`         | `{llm, jev}`                                        | 保存后的脱敏配置                                     |
| `POST /api/models`         | 可选 `{llm}`                                        | `{models}`                                           |
| `POST /api/book/options`   | `{question, category}`                              | `{options: {question, state, choices}}`              |
| `POST /api/book/decide`    | `{question, options}`                               | `{decision: {choiceId, probabilities, explanation}}` |
| `POST /api/book/follow-up` | `{question, options, decision, messages, followUp}` | `{answer}`                                           |

接口成功响应包含 `ok: true`，失败响应为 `{ok: false, error}`。追问历史 `messages` 格式为 `[{question, answer}]`，最多 6 轮；请把完整 `options` 传回决策和追问接口。

解释失败时，已经得到的 Jev 选择仍然返回，并设置 `explanationUnavailable: true`。TypeSafe 返回的选择与概率严格校验；Vercel 未提供分布时只展示选择，不补造数值。百分比是模型对候选的相对倾向，不是现实成功率。

## 项目结构

```text
answer-book/
  public/
    index.html       # 答案之书页面
    styles.css       # 纸质书本视觉与手机适配
    app.js           # 提问、结果、追问、历史与设置
    playground.html  # 保留的高级调试台
  src/
    app.js           # HTTP 接口
    book.js          # 决策与追问业务校验
    llm.js           # 大模型生成、解释与追问
    jev.js           # TypeSafe / Vercel 双通道
    config-store.js  # 配置持久化与脱敏
    timeout.js       # 外部调用超时
    static.js        # 静态文件服务
  test/              # 离线业务与接口测试
  data/config.json   # 本地私有配置，不提交
  server.mjs         # 服务入口，默认 9001 端口
```

首页使用原生 HTML、CSS、JavaScript 和本地 SVG，无前端构建步骤，也不依赖 CDN。书本插画由 CSS 绘制。保留的高级调试台使用原版 Vue / Element Plus CDN。

## 验证

```powershell
npm test
```

测试使用注入依赖和本地 HTTP 服务，覆盖流程、上下文、概率校验、错误处理、超时、配置脱敏与保存，不消耗真实 API 配额。

TypeSafe 接入依据：[介绍](https://docs.typesafe.ai/introduction)、[API](https://docs.typesafe.ai/api)、[Choice](https://docs.typesafe.ai/primitives/choice)。
