# video-renderer/Dockerfile — Node + FFmpeg for Cloud Run
FROM node:20-slim

# FFmpeg (with the filters we use: zoompan, xfade, drawtext, libass, freetype)
# + Noto Color Emoji so the emoji-captions extra has glyphs to fall back to.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fonts-noto-color-emoji fonts-noto-emoji ca-certificates \
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
