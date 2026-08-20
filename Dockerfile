FROM node:20-bookworm

RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip deno git && \
    pip3 install --break-system-packages -U "yt-dlp[default]" bgutil-ytdlp-pot-provider && \
    git clone --depth 1 --branch 1.3.1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider && \
    cd /opt/bgutil-ytdlp-pot-provider/server && \
    npm ci && \
    npx tsc && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["sh", "-c", "node /opt/bgutil-ytdlp-pot-provider/server/build/main.js & exec node server.js"]
