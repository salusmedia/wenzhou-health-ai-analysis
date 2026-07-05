'use strict';
// GLM 大模型客户端（智谱 AI，兼容 OpenAI Chat Completions 格式）
// 未配置 GLM_API_KEY 时，自动降级到内置结构化演示引擎，保证功能可完整体验。

const GLM_API_KEY = process.env.GLM_API_KEY || '';
const GLM_BASE_URL = (process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '');
const GLM_MODEL = process.env.GLM_MODEL || 'glm-5.2';

const hasGLM = !!GLM_API_KEY;

/**
 * 调用 GLM 对话补全。
 * @param {Array<{role,content}>} messages
 * @param {object} opts { temperature, json }
 * @returns {Promise<string>} 模型输出文本
 */
async function chat(messages, opts = {}) {
  if (!hasGLM) {
    return null; // 交由上层使用降级引擎
  }
  const body = {
    model: GLM_MODEL,
    messages,
    temperature: opts.temperature ?? 0.3,
    stream: false
  };
  if (opts.json) {
    body.response_format = { type: 'json_object' };
  }
  const resp = await fetch(`${GLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GLM_API_KEY}`
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`GLM API 错误 ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || '';
}

module.exports = { chat, hasGLM, model: GLM_MODEL };
