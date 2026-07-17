# video-renderer/Dockerfile — Node + FFmpeg for Cloud Run
FROM node:20-slim

# FFmpeg (with the filters we use: zoompan, xfade, drawtext, libass, freetype)
# + fontconfig so the bundled template fonts register system-wide (fc-cache
# below) — libass resolves caption fonts by family name through fontconfig.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fontconfig ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
# onnxruntime-node powers the depth-title person matting (segment.js)
RUN npm install --omit=dev --no-fund --no-audit
COPY . ./

# Register the bundled template fonts (Anton, Great Vibes, Patrick Hand,
# Prata) with fontconfig so libass finds them by family name.
RUN mkdir -p /usr/share/fonts/truetype/rqc \
  && cp /app/assets/fonts/*.ttf /usr/share/fonts/truetype/rqc/ \
  && fc-cache -f

ENV NODE_ENV=production
# Cloud Run sets PORT; default for local runs
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
