# syntax=docker/dockerfile:1

# ---------- 构建阶段：编译纯静态产物 ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---------- web 阶段：只运行静态 Web（nginx） ----------
FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

# ---------- verify 阶段：一次性验收（类型检查 + 单测 + e2e） ----------
# 该镜像自带与 Playwright 版本匹配的 Chromium 与全部系统依赖
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS verify
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# build 内含 tsc 类型检查与 vite 产物；test:unit 为坐标边界单测；
# playwright test 会自动用 vite preview 起静态站后跑上传/切换 e2e
CMD ["npm", "run", "verify"]
