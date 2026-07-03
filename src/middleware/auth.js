'use strict';
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'wenzhou-health-ai-dev-secret';

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '30d' });
}

function auth(role) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || '');
    if (!token) return res.status(401).json({ error: '未登录' });
    try {
      const decoded = jwt.verify(token, SECRET);
      if (role && decoded.role !== role) return res.status(403).json({ error: '无权访问' });
      req.user = decoded;
      next();
    } catch (e) {
      return res.status(401).json({ error: '登录已失效，请重新登录' });
    }
  };
}

module.exports = { sign, auth, SECRET };
