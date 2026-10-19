# Housefi HQ (the super admin portal): the static site behind nginx, which passes only /v1/admin/ to the API.
# Built from the backend folder: docker build -f admin/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY admin/ ./
RUN npm run build

# Runs as an unprivileged user on port 8080.
FROM nginxinc/nginx-unprivileged:1.30.4-alpine
COPY deploy/admin.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /admin/dist /usr/share/nginx/html
EXPOSE 8080
