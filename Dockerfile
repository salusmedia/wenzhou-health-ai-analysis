# 健康温州·个人医疗健康数据分析服务 —— 容器镜像（用于 Sealos App Launchpad 等容器平台部署）
FROM node:20-slim

WORKDIR /app

# 先装依赖（利用缓存层）。sql.js 为纯 JS/WASM，无需编译工具链。
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 拷贝应用源码
COPY . .

# SQLite 持久化目录（Sealos 建议将持久卷挂载到 /app/data）
RUN mkdir -p /app/data
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
