'use strict';
// 三版本管理（需求书 4.9）：模型 / 提示词 / 知识库版本独立版本化并联合留痕，任一输出可回放。
const glm = require('../glm');

module.exports = {
  MODEL_VERSION: glm.hasGLM ? glm.model : 'builtin-structured-1.0',
  PROMPT_VERSION: 'prompt-2026.07-p0',
  KB_VERSION: 'kb-2026.07-demo'
};
