# AI 答题接口核对

核对日期：2026-10-17。范围：当前下拉框内的七家服务商、19 个模型，以及单轮纯文本问答和连接测试。

结论：当前采用各家官方提供的 Chat Completions 或 OpenAI 兼容入口；POST、Bearer 鉴权、JSON 请求、system/user 消息、stream=false、choices[0].message.content 解析符合该范围的官方文档。文档核对和模拟验证不能代替账户密钥、余额、地区和模型权限的真实联调。

| 服务商 | 当前基础地址 | 核对结果与限制 | 官方依据 |
| --- | --- | --- | --- |
| GPT | https://api.openai.com/v1 | GPT-6.1 Sol、GPT-6 Astra、GPT-6 Luna 支持文本 Chat Completions。本程序不传工具参数，不套用各型号不同的工具调用限制。 | [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)、[Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| DeepSeek | https://api.deepseek.com | 已按官方当前示例使用根地址，追加 /chat/completions。模型为 deepseek-flash、deepseek-v4-pro。 | [快速开始](https://api-docs.deepseek.com/)、[参数参考](https://api-docs.deepseek.com/api/create-chat-completion/) |
| Qwen | https://dashscope.aliyuncs.com/compatible-mode/v1 | 国内兼容入口仍受支持；账号所属地域与密钥必须匹配。海外或业务空间专属入口需要用户修改基础地址。当前商业模型支持非流式；不额外传 enable_thinking、reasoning_effort 或 thinking_budget，保留官方默认。 | [兼容接入与地区说明](https://www.alibabacloud.com/help/zh/model-studio/compatibility-of-openai-with-dashscope)、[参数参考](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions/)、[非流式说明](https://help.aliyun.com/zh/model-studio/deep-thinking) |
| Gemini | https://generativelanguage.googleapis.com/v1beta/openai | 使用 Google 官方 OpenAI 兼容入口和 Gemini API key；Bearer 鉴权与官方 REST 示例一致。 | [OpenAI 兼容说明](https://ai.google.dev/gemini-api/docs/openai)、[模型目录](https://ai.google.dev/gemini-api/docs/models) |
| Kimi | https://api.moonshot.cn/v1 | 使用国内开放平台密钥；不显式设置 K3 固定的 temperature、top_p、n 等参数。只处理单轮问答，未实现需要完整回传 assistant message 的多轮或工具流程。已移除官方下线的 K2.5、moonshot-v1 预设。 | [快速开始](https://platform.kimi.com/docs/get-api-key)、[K3 参数限制](https://platform.kimi.com/docs/guide/kimi-k3-quickstart)、[模型与下线说明](https://platform.kimi.com/docs/models) |
| GLM | https://open.bigmodel.cn/api/paas/v4 | 国内官方 Chat Completion API，Bearer 鉴权。保留模型默认思考设置，不发送 GLM-5.3 系列不接受的禁用思考参数；普通按量 API 与 Coding Plan 套餐入口不能混用。 | [对话补全](https://docs.bigmodel.cn/api-reference/模型-api/对话补全)、[型号目录](https://docs.bigmodel.cn/cn/guide/start/model-overview)、[Flash 说明](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash) |
| Grok | https://api.x.ai/v1 | Grok 4.7 的 Chat Completions 仍是官方支持的旧版入口，可用于当前基础文本答题。官方推荐新功能优先使用 Responses，但本程序没有启用这些功能，不需要为了单轮问答强制迁移。 | [官方 Chat Completions 示例](https://docs.x.ai/developers/model-capabilities/legacy/chat-completions)、[Grok 4.7 指南](https://docs.x.ai/developers/grok-4-7) |

本次修正：

- 公网服务缺少密钥时在发送前报错；阻止密钥中的换行进入 HTTP 请求头。本地服务仍允许无密钥。
- finish_reason=length 的不完整答案不再当作成功答案。
- 内容过滤、拒答、工具调用和仅含思考过程的响应不作为最终答案返回；思考过程不显示为答案。
- 增补 HTTP 400、402、422、500、503 的中文提示，不回显密钥或服务端原始响应正文。
- 超时设置允许 5–3600 秒，原配置和默认 45 秒保持不变。复杂推理任务可按需提高；本地超时不能撤销已经开始的服务端生成或计费。
- DeepSeek 新建预设地址对齐当前官方示例；已保存配置不自动改写。

验证：46 项通过（7 项本地 HTTP 接口测试、5 项参数与异常响应测试、5 项配置界面测试、29 项原有界面测试）。参数测试遍历全部 19 个预设模型，检查地址、方法、鉴权、消息格式、非流式参数和答案解析；使用模拟传输，不会连接模型服务。Windows DPAPI 加密往返测试不在本次计数内，该项此前因运行环境限制失败。

尚未验证：七家账户的真实密钥、余额、地区、模型开放权限及端到端延迟；没有发起真实计费请求。未重新打包 EXE。当前也未提供流式展示、图片题目、工具调用或多轮上下文。
