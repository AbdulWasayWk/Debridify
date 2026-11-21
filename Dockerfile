# ── dev: full toolchain (tsx, tsc, tests). Used by the `dev` compose service and for running tests/smoke.
FROM node:24-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
COPY test ./test
COPY scripts ./scripts
COPY public ./public
ENV DATA_DIR=/data
EXPOSE 7000
CMD ["npm", "start"]

# ── build: typecheck, run unit tests, compile. A failing test fails the image build.
FROM dev AS build
RUN npm run typecheck && npm test && npm run build

# ── runtime: compiled JS + production deps only.
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY public ./public
VOLUME /data
EXPOSE 7000
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
	CMD node -e "fetch('http://127.0.0.1:7000/health?torbox=0').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
