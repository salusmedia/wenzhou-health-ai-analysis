'use strict';
// 商业模式：收费模式 / 定价策略（示意）/ 医生分成
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const router = express.Router();

// 定价方案（公开，示意价，最终以主管部门指导为准）
const PRODUCTS = [
  { key: 'single', name: '单次 AI 深度解读', price: 39, unit: '次', desc: '一次完整的健康报告 + 第二意见分析', doctor_share: 0.5 },
  { key: 'quarter', name: '季度健康管家会员', price: 99, unit: '季', desc: '无限次解读 + 慢病趋势追踪 + 诊前准备', doctor_share: 0.4 },
  { key: 'year', name: '年度健康管家会员', price: 299, unit: '年', desc: '全年无限次 + 家庭共享 + 优先医生解读', doctor_share: 0.4 }
];

router.get('/products', (req, res) => {
  res.json({
    products: PRODUCTS.map(p => ({ ...p, doctor_share_label: (p.doctor_share * 100) + '%' })),
    note: '以上价格为方案示意，最终定价与分成比例需结合成本测算、市场调研与主管部门指导确定；对特定困难群体提供公益减免通道。'
  });
});

router.post('/order', auth('patient'), (req, res) => {
  const pid = req.user.id;
  const { product, doctor_id } = req.body;
  const prod = PRODUCTS.find(p => p.key === product);
  if (!prod) return res.status(400).json({ error: '无效的产品' });
  const share = doctor_id ? +(prod.price * prod.doctor_share).toFixed(2) : 0;
  const o = db.prepare('INSERT INTO orders (patient_id,product,amount,doctor_id,doctor_share,platform_share,status) VALUES (?,?,?,?,?,?,?)')
    .run(pid, prod.name, prod.price, doctor_id || null, share, +(prod.price - share).toFixed(2), '已支付');
  res.json({ ok: true, order_id: o.lastInsertRowid, product: prod.name, amount: prod.price });
});

router.get('/my-orders', auth('patient'), (req, res) => {
  res.json(db.prepare('SELECT * FROM orders WHERE patient_id=? ORDER BY id DESC').all(req.user.id));
});

module.exports = router;
