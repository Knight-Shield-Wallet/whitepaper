FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs ./
RUN addgroup -S ksd && adduser -S -G ksd ksd
RUN mkdir -p /data && chown -R ksd:ksd /app /data
USER ksd
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
CMD ["node","server.mjs"]
