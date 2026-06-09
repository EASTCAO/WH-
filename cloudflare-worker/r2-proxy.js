/**
 * Cloudflare Worker：R2 媒体代理
 *
 * 作用：把 R2 bucket 的文件通过 Cloudflare 网络（免费 workers.dev 域名）对外提供，
 * 绕开 pub-xxx.r2.dev 公共域名的限速，视频不再卡。
 *
 * 部署步骤见同目录 README.md。关键：
 *  - 在 Worker 的 Settings → Bindings 里加一个 R2 bucket 绑定，变量名必须是 BUCKET
 *  - 部署后得到 https://<worker名>.<你的子域>.workers.dev
 *
 * 已正确处理 HTTP Range（视频拖动/分段加载）、ETag、缓存、CORS。
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // 对象 key = 路径去掉开头的斜杠，例如 /photo-review/2026-05/xx/yy.mp4 -> photo-review/2026-05/xx/yy.mp4
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, If-Match, If-None-Match, If-Modified-Since, If-Unmodified-Since",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { ...cors, "Access-Control-Max-Age": "86400" } });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } });
    }

    if (!key) return new Response("Not Found", { status: 404, headers: cors });

    // range / onlyIf 直接把请求头传给 R2，由 R2 解析 Range 与条件请求
    const object = await env.BUCKET.get(key, {
      range: request.headers,
      onlyIf: request.headers,
    });

    if (object === null) {
      return new Response("Not Found", { status: 404, headers: cors });
    }

    const headers = new Headers(cors);
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    let status = 200;
    if (object.body && request.headers.get("range") && object.range) {
      const offset = object.range.offset ?? 0;
      const length = object.range.length ?? (object.size - offset);
      const end = offset + length - 1;
      headers.set("Content-Range", `bytes ${offset}-${end}/${object.size}`);
      headers.set("Content-Length", String(length));
      status = 206;
    } else if (!object.body) {
      // onlyIf 命中（如 If-None-Match 未变），无 body
      status = 304;
    }

    return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
  },
};
