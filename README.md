# 日历应用

一个功能完整的日历应用，支持添加、编辑和删除事件。

## 功能特性

- 📅 直观的日历界面
- ➕ 添加新事件
- ✏️ 编辑现有事件
- 🗑️ 删除事件
- 🎨 自定义事件颜色
- 📱 响应式设计

## 技术栈

### 后端
- Flask
- SQLAlchemy
- SQLite数据库
- Flask-CORS

### 前端
- React
- Axios
- Moment.js
- React Modal

## 安装和运行

### 后端

1. 进入后端目录：
   ```bash
   cd backend
   ```

2. 安装依赖：
   ```bash
   pip install -r requirements.txt
   ```

3. 运行服务器：
   ```bash
   python app.py
   ```

后端将在 http://localhost:5000 运行。

### 前端

1. 进入前端目录：
   ```bash
   cd frontend
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. 启动开发服务器：
   ```bash
   npm start
   ```

前端将在 http://localhost:3000 运行。

## API 端点

- `GET /api/events` - 获取当前登录用户的所有事件（支持年月过滤）
- `GET /api/events/<id>` - 获取单个事件，仅限属于用户自己的
- `POST /api/events` - 为当前用户创建新事件
- `PUT /api/events/<id>` - 更新事件，仅限自己的事件
- `DELETE /api/events/<id>` - 删除事件，仅限自己的事件
- `GET /api/user-data` - 同时返回用户个人信息和属于此账号的所有事件


### 数据库结构

- `user` 表保存账户及个人主页字段，包含 `username`、`password`、`name`、`email`、`bio`、`gender`、`birthdate`、`avatar` 等。
- `event` 表现在包含 `user_id` 外键，指向创建该事件的用户。

事件查询均依据 `user_id` 做筛选，确保信息和账号关联。

## 部署到云端（Render + Vercel）

推荐方案：
1. 后端部署到 Render。
2. 前端部署到 Vercel。

### 1. 准备工作

1. 将项目推送到 GitHub。
2. 注册 Render 账号与 Vercel 账号。
3. 确认后端目录为 `backend`，前端目录为 `frontend`。

### 2. 后端部署（Render）

1. 登录 Render 控制台，点击 `New` -> `Web Service`。
2. 选择本仓库。
3. 部署参数填写如下：
   - Name: `calendar-backend`（可自定义）
   - Root Directory: `backend`
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `gunicorn --worker-class eventlet -w 1 app:app --bind 0.0.0.0:$PORT`
4. 在 Environment Variables 中添加：
   - `APP_ENV=production`
   - `SECRET_KEY=<随机长字符串>`
   - `CORS_ORIGINS=`（先留空或先填临时值，前端上线后再更新）
5. 点击 `Create Web Service` 部署。
6. 部署成功后获取后端域名，例如：`https://calendar-backend.onrender.com`

生成 `SECRET_KEY` 示例（本机执行）：

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### 3. 前端部署（Vercel）

1. 登录 Vercel 控制台，点击 `Add New` -> `Project`。
2. 导入本仓库。
3. 配置如下：
   - Framework Preset: `Create React App`
   - Root Directory: `frontend`
4. 添加环境变量：
   - `REACT_APP_API_BASE_URL=https://calendar-backend.onrender.com/api`
5. 点击 `Deploy`。
6. 部署成功后获取前端域名，例如：`https://calendar-frontend.vercel.app`

### 4. 回填 CORS

1. 回到 Render 项目环境变量。
2. 将 `CORS_ORIGINS` 更新为前端域名：
   - `CORS_ORIGINS=https://calendar-frontend.vercel.app`
3. 触发一次重新部署（Manual Deploy 或保存变量后自动重启）。

如果有多个前端域名，可用英文逗号分隔：

```text
https://calendar-frontend.vercel.app,https://www.your-domain.com
```

### 5. 验证清单

1. 打开前端网址，测试注册/登录。
2. 测试日历事件新增、编辑、删除。
3. 测试会议室功能（含屏幕共享）。
4. 测试会议摘要生成功能。

### 6. 注意事项

1. 数据库使用 SQLite，Render 部署后会在容器内创建数据库文件。
2. 免费实例可能休眠，首次访问会有冷启动延迟。
3. Vercel 与 Render 默认提供 HTTPS。
4. 可在两个平台分别绑定自定义域名。

### 7. 常见故障排查

1. CORS 报错：检查 `CORS_ORIGINS` 是否与前端实际域名完全一致（含协议）。
2. API 请求失败：检查 `REACT_APP_API_BASE_URL` 是否以 `/api` 结尾。
3. Render 启动失败：确认 Start Command 使用了 `--bind 0.0.0.0:$PORT`。
4. Vercel 刷新页面 404：确认 `frontend/vercel.json` 已存在并已生效。

如需 GitHub Pages 部署前端，仍可使用以下命令：

```bash
npm run build
npm run deploy
```

## 许可证

MIT License