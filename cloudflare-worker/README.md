# R2 媒体代理 Worker 部署说明

目的：用免费的 Cloudflare Worker 把 R2 文件通过 Cloudflare CDN 对外提供，绕开
`pub-xxx.r2.dev` 公共域名的限速，让视频不再卡。完全免费。

脚本：`r2-proxy.js`

---

## 一、在 Cloudflare 创建 Worker

1. 登录 Cloudflare → 左侧 **Workers & Pages**（计算/Workers）
2. **Create application → Create Worker**
3. 起个名字，比如 `media`（最终地址会是 `https://media.<你的子域>.workers.dev`）
4. 点 **Deploy** 先部署一个默认的
5. 部署后点 **Edit code（编辑代码）**，把整个默认代码删掉，
   粘贴 `r2-proxy.js` 的全部内容，再点右上 **Deploy**

## 二、把 R2 bucket 绑定给这个 Worker（关键！）

1. 在这个 Worker 页面 → **Settings（设置）** → **Bindings（绑定）**
2. **Add → R2 bucket**
3. **Variable name（变量名）** 必须填：`BUCKET`（脚本里用的就是这个名字）
4. **R2 bucket** 选你存照片/视频的那个 bucket
5. 保存。绑定后 Worker 会重新部署一次

## 三、记下 Worker 地址

部署完成后，Worker 详情页会显示访问地址，形如：

```
https://media.<你的子域>.workers.dev
```

把这个地址发给我（或记下来）。**注意不要带末尾斜杠、不要带 /photo-review**。

## 四、验证 Worker 能取到文件

浏览器打开（把下面换成你的 Worker 地址）：

```
https://media.<你的子域>.workers.dev/photo-review/2026-05/64bcc78a3f911652/e987d4fd05c7ebe7_display.mp4
```

能播放/下载视频 = 绑定成功。

---

## 五、接下来（我来做）

1. 改 Zeabur 环境变量
   `STORAGE_PUBLIC_BASE_URL` = `https://media.<你的子域>.workers.dev`
   （纯域名，不带 /photo-review）
2. 用迁移接口把已有 36 个视频/图片的旧 URL 换成新地址（先 dryRun 预览，再实跑）
3. 测速 + 验证不卡

迁移接口（已上线）：
```
POST /api/admin/migrate-media-urls
{ "adminCode": "...", "from": "https://pub-44617efa60aa481caabd485df2b5b38e.r2.dev", "to": "https://media.<你的子域>.workers.dev", "dryRun": true }
```
