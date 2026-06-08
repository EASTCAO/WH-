#!/usr/bin/env bash
#
# deploy.sh — 一键部署到 Zeabur 线上
#
# 为什么需要这个脚本：
#   线上服务没有绑定 GitHub 仓库，所以 `git push` 不会触发自动部署。
#   唯一的上线方式是用 Zeabur CLI 从本地目录上传。
#   （服务名 c--users-admin-documents-codex-... 就是本地路径，是 CLI 上传创建的）
#
# 用法：
#   ./deploy.sh            # 部署并自动验证是否上线
#   ./deploy.sh --no-check # 只部署，不等待验证
#
# 前置条件：
#   1. 已安装 Zeabur CLI（npm i -g zeabur）
#   2. 已登录（zeabur auth login）；可用 `zeabur profile info` 确认
#
# 注意：
#   .zeaburignore 已排除 data/db.json、data/uploads/、恢复文件和一次性脚本，
#   所以本次上传不会覆盖线上 /data 持久盘的数据。
#   记得正式上线前用 git 提交一次，保留历史（但 push 本身不会部署）。

set -euo pipefail

# ---- 部署目标（来自 untitled-3 项目，账号 曹东 / cd199187@gmail.com）----
SERVICE_ID="6a1e68b5a853e9fa73f093e3"
ENV_ID="6a1e67ddb0fc054c4cc40683"
HEALTH_URL="https://whsj-photo-review.zeabur.app/api/system"

CHECK=1
[ "${1:-}" = "--no-check" ] && CHECK=0

cd "$(dirname "$0")"

echo "==> 开始部署到 Zeabur（本地上传，约 1-2 分钟构建）..."
zeabur deploy --service-id "$SERVICE_ID" --environment-id "$ENV_ID" -i=false

if [ "$CHECK" -eq 0 ]; then
  echo "==> 已上传，跳过验证。可稍后访问 $HEALTH_URL 查看 optimizeQueue.concurrency 是否为 2。"
  exit 0
fi

echo "==> 上传完成，等待云端构建生效（轮询 $HEALTH_URL，concurrency=2 表示新代码已上线）..."
for i in $(seq 1 16); do
  sleep 20
  C=$(curl -s --max-time 15 "$HEALTH_URL" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(String(JSON.parse(d).optimizeQueue.concurrency))}catch{process.stdout.write('?')}})" 2>/dev/null || echo "?")
  echo "    检查 ${i} ($(date +%H:%M:%S)): concurrency = ${C}"
  if [ "$C" = "2" ]; then
    echo "==> ✅ 新代码已上线。"
    exit 0
  fi
done

echo "==> ⚠ 等待超时（约 5 分钟仍未变为 2）。请去 Zeabur 控制台看构建日志，或稍后再访问 $HEALTH_URL 确认。" >&2
exit 1
