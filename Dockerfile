FROM node:22-bookworm

RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip git curl unzip && \
    curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh && \
    deno --version && \
    pip3 install --break-system-packages -U --pre "yt-dlp[default]" bgutil-ytdlp-pot-provider && \
    git clone --depth 1 --branch 1.3.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider && \
    cd /opt/bgutil-ytdlp-pot-provider/server && \
    npm ci && \
    npx tsc && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV YT_DLP_POT_PROVIDER_URL=http://127.0.0.1:4416
EXPOSE 3000

CMD ["sh", "-c", "node /opt/bgutil-ytdlp-pot-provider/server/build/main.js & exec node server.js"]
