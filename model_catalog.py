"""Official text-model presets verified 2026-10-17; account access may vary."""

# Set this to the future help / purchase page's HTTPS URL.
AI_HELP_URL = ""

# Sources: developers.openai.com/api/docs/models,
# api-docs.deepseek.com/api/create-chat-completion,
# alibabacloud.com/help/zh/model-studio/models,
# ai.google.dev/gemini-api/docs/models, platform.kimi.com/docs/models,
# docs.z.ai/guides/llm/glm-5.3, docs.x.ai/developers/models,
# www.volcengine.com/docs/82379/1462484 (火山方舟).
# Display name, API base URL, model IDs (current generation first).
PROVIDERS = [
    ("开放人工智能 / GPT", "https://api.openai.com/v1", ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"]),
    ("深度求索 / DeepSeek", "https://api.deepseek.com", ["deepseek-v4-flash", "deepseek-v4-pro"]),
    ("火山引擎 / 豆包", "https://ark.cn-beijing.volces.com/api/v3", ["doubao-seed-2-1-pro-260628", "doubao-seed-2-1-turbo-260628", "doubao-seed-evolving", "deepseek-v4-1-flash-260910", "deepseek-v4-pro-ga-260813", "deepseek-v4-flash-ga-260731", "deepseek-v3", "deepseek-r1"]),
    ("通义千问 / Qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1", ["qwen3.8-max", "qwen3.7-plus", "qwen3.7-flash"]),
    ("谷歌 / Gemini", "https://generativelanguage.googleapis.com/v1beta/openai", ["gemini-4-argon", "gemini-3.8-flash", "gemini-3.5-flash-lite"]),
    ("月之暗面 / Kimi", "https://api.moonshot.cn/v1", ["kimi-k3", "kimi-k2.6", "kimi-k2.7-code", "kimi-k2.7-code-highspeed"]),
    ("智谱 / GLM", "https://open.bigmodel.cn/api/paas/v4", ["glm-5.3", "glm-5.3-flash", "glm-5.2"]),
    ("马斯克人工智能 / Grok", "https://api.x.ai/v1", ["grok-4.7"]),
]
