FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    DATABASE_PATH=/app/data/accountabilibuddy.db

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# The database lives on a volume mounted here; the node user must own it.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
USER node

# Re-registering slash commands on every start is idempotent and means
# command changes go live with a plain rebuild.
CMD ["sh", "-c", "node --disable-warning=ExperimentalWarning src/deploy-commands.js && exec node --disable-warning=ExperimentalWarning src/index.js"]
