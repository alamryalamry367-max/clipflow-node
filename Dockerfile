FROM node:20-bookworm

RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip deno && \
    pip3 install --break-system-packages -U "yt-dlp[default]" && yt-dlp --version && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
