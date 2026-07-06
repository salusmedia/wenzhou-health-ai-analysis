# Sealos 部署手册 · 健康温州个人医疗健康数据分析服务

在 **sealos.run** 上用「应用管理 App Launchpad」+「持久卷 + SQLite」方式复制部署一份。
镜像已由 GitHub Actions 自动构建并公开发布，**无需你本地装 Docker**。

> 与 Railway 版并存、互不影响：同一份代码 → 同一个镜像 → 两个云各跑一份。

---

## 0. 已就绪（我这边已完成）

- ✅ 容器镜像：`ghcr.io/salusmedia/wenzhou-health-ai-analysis:latest`
- ✅ 已验证 **匿名公开可拉取**（Sealos 无需任何镜像凭据即可拉）
- ✅ 每次 `git push` 到 main，Actions 会自动重建并更新 `latest`

---

## 1. 进入 App Launchpad

登录 https://sealos.run → 桌面上打开 **「应用管理 / App Launchpad」** → 点 **「新建应用 / Create App」**。

## 2. 基础配置

| 项 | 填写 |
|---|---|
| 应用名称 | `wenzhou-health-ai` |
| 镜像源 | 选 **公共 / Public** |
| 镜像名 | `ghcr.io/salusmedia/wenzhou-health-ai-analysis:latest` |
| CPU | `0.5 Core`（足够） |
| 内存 | `512 Mi` |
| 实例数 | `1`（用 SQLite+持久卷时**必须固定 1 副本**，勿开弹性伸缩） |

## 3. 网络（开公网）

- **容器暴露端口 / Container Port**：`3000`
- **开启公网访问 / Enable Public Access**：**打开**
- 协议 `HTTP`；Sealos 会自动分配一个 `https://xxxx.sealos.run` 域名（也可后续绑自有域名）

## 4. 环境变量（Environment Variables）

粘贴以下内容（一行一个）：

```
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GLM_MODEL=glm-5.2
JWT_SECRET=wz-health-de7238691e4cbeb50af75e93a960ab08
ADMIN_KEY=admin123
NODE_ENV=production
```

> - `GLM_API_KEY`：**另加一行** `GLM_API_KEY=你的智谱APIKey`。
>   不填也能跑（自动降级为内置结构化引擎，功能可完整体验）；填了才会真正调用 GLM-5.2 大模型。
> - `ADMIN_KEY` 是监管台 `/admin` 的口令，建议改成你自己的强口令。
> - `PORT` 无需设置（镜像已内置 3000，与暴露端口一致）。

## 5. 持久化存储（关键 —— 数据不丢）

在「高级配置 / Advanced」→「存储卷 / Storage」新增一个 PVC：

| 项 | 填写 |
|---|---|
| 容量 | `1 Gi` |
| 挂载路径 / Mount Path | `/app/data` |

> 应用把 SQLite 库写在 `/app/data/health.sqlite`。挂载后，重启/更新都不丢数据；
> 首次启动会自动播种演示数据（演示患者「张明」、医生 doctor/doctor2）。播种是幂等的，重启不会重复。

## 6. 部署

点 **「部署 / Deploy」**。等状态变为 **Running**（约 1–2 分钟，首次要拉镜像）。

## 7. 验收

打开 Sealos 分配的公网域名：

- 患者端（健康温州小程序）：`https://<你的域名>/`
- HI 医生端：`https://<你的域名>/doctor`（账号 `doctor` / `123456`，或 `doctor2`）
- 监管台：`https://<你的域名>/admin`（口令 = 上面的 `ADMIN_KEY`）
- 健康检查：`https://<你的域名>/api/health` → 应返回 `{"status":"ok",...}`，其中 `glm` 字段显示是否已接入密钥

---

## 更新版本

以后改了代码 `git push` 到 main → Actions 自动重建 `latest` → 在 Sealos 应用详情点 **「重启 / Restart」**（或「更新」重新拉取镜像）即可用上新版本。数据因挂了持久卷不受影响。

## 备注 / 后续

- 单副本 + SQLite 适合试点。将来要多副本/高并发，再迁移到 Sealos 托管 PostgreSQL（数据层是兼容封装，改造量中等，非重写）。
- 医疗数据放境内 Sealos，契合方案「数据不出域」的合规定调；GLM 境内直连更稳更快。
- 正式对外 + 自有域名需 ICP 备案及相应业务资质（业务合规层面，非技术阻塞）。
