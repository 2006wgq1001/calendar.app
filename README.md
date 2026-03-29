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

## 部署

推荐方案：
1. 后端部署到 Render（支持 Socket.IO）
2. 前端部署到 Vercel（React 静态站点）

### 后端部署到 Render

1. 在 Render 新建 Web Service，根目录选择 backend。
2. Build Command：
   pip install -r requirements.txt
3. Start Command：
   gunicorn --worker-class eventlet -w 1 app:app
4. 环境变量至少配置：
   - APP_ENV=production
   - SECRET_KEY=随机长字符串
   - CORS_ORIGINS=https://你的前端域名
5. 部署成功后得到后端域名，例如：
   https://your-backend-domain.onrender.com

### 前端部署到 Vercel

1. 导入仓库后，将 Frontend Root 设置为 frontend。
2. 在 Vercel 环境变量中配置：
   - REACT_APP_API_BASE_URL=https://你的后端域名/api
   - REACT_APP_SIGNAL_URL=https://你的后端域名
3. 重新部署前端，得到前端域名。

### 部署后检查

1. 打开前端网址，完成注册/登录。
2. 进入会议室，测试多人加入同一房间。
3. 测试会议摘要与同步任务功能。

如需 GitHub Pages 部署前端，仍可使用以下命令：

```bash
npm run build
npm run deploy
```

## 许可证

MIT License