# 作品评优系统 Zeabur 上线说明

## 1. 上线前准备

1. 安装依赖：

```powershell
npm install
```

2. 清空本地测试数据：

```powershell
npm run reset-data
```

这个命令会清空作品、投票、月份和上传文件，并保留当前摄影师名单。
如果正式环境第一次启动且还没有 `db.json`，系统会从 `data/photographers.json` 初始化摄影师名单。

如果确实要连摄影师名单也一起清空，再运行：

```powershell
npm run reset-all
```

3. 本地启动检查：

```powershell
$env:ADMIN_CODE="你的管理员口令"
npm start
```

打开 `http://localhost:3000/`，确认登录页能显示。

## 2. Zeabur 配置

在 Zeabur 新建 Node.js 服务并连接这个项目仓库。

环境变量建议设置：

```text
ADMIN_CODE=你的管理员口令
DATA_DIR=/data
NODE_ENV=production
MAX_UPLOAD_MB=512
MAX_FILES_PER_UPLOAD=200
```

持久存储空间：

- Volume ID：`photo-review-data`
- Mount Directory：`/data`

`DATA_DIR=/data` 后，系统会把 `db.json` 和 `uploads` 都保存到 Zeabur 的持久盘里，服务重启后数据不会丢。

## 3. 正式使用流程

1. 管理员用 `ADMIN_CODE` 登录后台。
2. 在后台添加摄影师姓名。
3. 上传作品到对应模块。
4. 点击“开始投票”。
5. 摄影师打开网站，只输入自己的姓名登录投票。
6. 投票结束后，管理员点击“公布结果”。

## 4. 注意事项

- 摄影师当前只用姓名登录，不设置密码；公开网址下别人知道姓名就可能冒用投票。
- 管理员口令必须足够复杂，不要使用 `admin123`。
- 不要把 `data/uploads` 和 `data/db.json` 当作源码提交；线上正式数据应保存在 Zeabur 持久盘。
- 如果上传特别大的视频，可以在 Zeabur 环境变量里调大 `MAX_UPLOAD_MB`。
## 5. 对象存储直传（可选）

如果后续上传人数多、图片很大，建议启用 S3 兼容对象存储直传，例如 Cloudflare R2。启用后，图片和视频会从浏览器直接上传到对象存储，Zeabur 只保存作品 URL，可以明显降低 Zeabur 带宽和 CPU 压力。

Zeabur 环境变量示例：

```text
STORAGE_ENDPOINT=https://你的账号ID.r2.cloudflarestorage.com
STORAGE_BUCKET=你的bucket名称
STORAGE_REGION=auto
STORAGE_ACCESS_KEY_ID=你的Access Key ID
STORAGE_SECRET_ACCESS_KEY=你的Secret Access Key
STORAGE_PUBLIC_BASE_URL=https://你的公开访问域名
STORAGE_PREFIX=photo-review
```

对象存储需要配置 CORS，至少允许网站域名发起 `PUT` 上传：

```json
[
  {
    "AllowedOrigins": ["https://whsj-photo-review.zeabur.app"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

未配置这些变量时，系统会自动继续使用 Zeabur 本地上传，不影响当前流程。
