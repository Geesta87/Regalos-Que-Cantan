# story-builder/Dockerfile — Node + FFmpeg for Cloud Run (same base as video-renderer)
FROM node:20-slim

# FFmpeg (with the filters we use: zoompan, xfade, drawtext, freetype)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
# No external npm deps (uses Node built-ins + global fetch), so no npm install needed.
COPY . ./

ENV NODE_ENV=production
# Cloud Run sets PORT; default for local runs
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
