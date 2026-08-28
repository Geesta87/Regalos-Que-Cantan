# Cloud Run JOB image for the offsite backup worker (see index.js — copy-only).
FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY index.js ./
CMD ["node", "index.js"]
