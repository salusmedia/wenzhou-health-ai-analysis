'use strict';
// 商业模式（整合版第八章）：基础免费 + 增值自愿付费 + 分阶段放开 + 公益减免；医生收益由机构统一结算，无个人分成。
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const router = express.Router();

// 基础公共服务（永久免费）
const FREE = [
  { key: 'archive', name: '基础健康档案', desc: '多机构数据聚合、时间轴、慢病专区、用药记录、授权管理', price: 0 }
];

// 增值付费（分阶段放开；phase 标注上线阶段）
const PRODUCTS = [
  { key: 'single_report', name: '单次健康数据解读报告', price: 9.9, unit: '次', phase: '一期', desc: '一次完整 AI 数据解读报告，可导出 PDF；仅含汇总、指标解释、趋势与诊前提问，不含个性化诊疗意见' },
  { key: 'chronic_month', name: '慢病月度提醒', price: 19.9, unit: '月', phase: '一期', desc: '月度报告、指标追踪、复诊/用药提醒（基于既有医嘱，不自动生成治疗计划）' },
  { key: 'year_member', name: '年度会员', price: 199, unit: '年', phase: '二期', desc: '会员权益 + 季度深度报告 + 医生确认版参考视角（需绑定医生确认）', locked: true },
  { key: 'family_year', name: '家庭年卡', price: 399, unit: '年', phase: '三期', desc: '年度会员权益 × 3 名家庭成员，需先完成家庭代管授权风控', locked: true }
];

router.get('/products', (req, res) => {
  res.json({
    free: FREE,
    products: PRODUCTS,
    charity: '困难群体、老年慢病重点人群可申请公益减免（免费或补贴名额），由主管部门确定条件。',
    settlement: '医生收益由医疗机构统一结算为绩效/劳务补偿，与药品、检查、处方、转诊、复诊量及患者购买金额均无关，平台不向个人医生直接返佣。',
    note: '基础健康档案永久免费；以上增值价格为示意，最终定价与补偿规则须结合成本测算、市场调研与主管部门指导确定。'
  });
});

router.post('/order', auth('patient'), (req, res) => {
  const pid = req.user.id;
  const { product } = req.body;
  const prod = PRODUCTS.find(p => p.key === product);
  if (!prod) return res.status(400).json({ error: '无效的产品' });
  if (prod.locked) return res.status(400).json({ error: `「${prod.name}」为${prod.phase}功能，暂未开放` });
  // 平台收入进入统一账户，无个人返佣（doctor_share 恒为 0）
  const o = db.prepare('INSERT INTO orders (patient_id,product,amount,doctor_id,doctor_share,platform_share,status) VALUES (?,?,?,?,?,?,?)')
    .run(pid, prod.name, prod.price, null, 0, prod.price, '已支付');
  res.json({ ok: true, order_id: o.lastInsertRowid, product: prod.name, amount: prod.price });
});

router.get('/my-orders', auth('patient'), (req, res) => {
  res.json(db.prepare('SELECT * FROM orders WHERE patient_id=? ORDER BY id DESC').all(req.user.id));
});

// 公益减免申请（演示）
router.post('/charity-apply', auth('patient'), (req, res) => {
  db.prepare('INSERT INTO authorization_logs (patient_id,action,data_type,ip) VALUES (?,?,?,?)')
    .run(req.user.id, '提交公益减免申请', '待主管部门审核', 'self');
  res.json({ ok: true, message: '公益减免申请已提交，将由主管部门按条件审核。' });
});

module.exports = router;
