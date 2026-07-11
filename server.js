'use strict';
const path = require('path');
const express = require('express');
const db = require('./src/db');
const { seed, backfillAuthGrants } = require('./src/seed');
const glm = require('./src/glm');

const app = express();
app.use(express.json({ limit: '2mb' }));

// API 路由
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/records', require('./src/routes/records'));
app.use('/api/authorization', require('./src/routes/authorization'));
app.use('/api/ai', require('./src/routes/ai'));
app.use('/api/connect', require('./src/routes/connect'));
app.use('/api/doctor', require('./src/routes/doctor'));
app.use('/api/billing', require('./src/routes/billing'));
app.use('/api/audit', require('./src/routes/audit'));
app.use('/api/admin', require('./src/routes/admin'));

// 系统信息
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: '健康温州·个人医疗健康数据分析服务', glm: glm.hasGLM ? `已接入 ${glm.model}` : '未配置(使用内置演示引擎)', time: new Date().toISOString() });
});

// 静态资源
app.use(express.static(path.join(__dirname, 'public')));

// 医生端入口
app.get('/sso', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sso.html'))); // 温健钉免登·按 role 自动登录
app.get('/doctor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'doctor', 'index.html')));

// 监管台入口
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));
app.get('/hospital', (req, res) => res.sendFile(path.join(__dirname, 'public', 'hospital', 'index.html')));

// 患者端 SPA 兜底
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
(async () => {
  await db.init();       // 初始化 sql.js（加载 WASM）
  seed();                // 首次启动播种演示数据
  backfillAuthGrants();  // 四维授权初值（幂等，兼容旧库）
  app.listen(PORT, () => {
    console.log(`\n健康温州·个人医疗健康数据分析服务已启动`);
    console.log(`  患者端(健康温州小程序):  http://localhost:${PORT}/`);
    console.log(`  HI 医生端:                http://localhost:${PORT}/doctor`);
    console.log(`  GLM 大模型:               ${glm.hasGLM ? '已接入 ' + glm.model : '未配置，使用内置演示引擎'}\n`);
  });
})();
