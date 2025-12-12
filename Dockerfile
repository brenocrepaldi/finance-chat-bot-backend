# Stage 1: Build
FROM node:20-alpine AS builder

# Instala dependências do sistema necessárias para o Baileys
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev

# Define diretório de trabalho
WORKDIR /app

# Copia arquivos de dependências
COPY package*.json ./

# Instala TODAS as dependências (incluindo devDependencies para compilar)
RUN npm ci

# Copia o código fonte
COPY . .

# Compila TypeScript
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

# Instala dependências do sistema necessárias para o Baileys
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev

# Define diretório de trabalho
WORKDIR /app

# Copia arquivos de dependências
COPY package*.json ./

# Instala apenas dependências de produção
RUN npm ci --omit=dev

# Copia código compilado do stage anterior
COPY --from=builder /app/dist ./dist

# Cria diretório para sessão do WhatsApp
RUN mkdir -p /app/auth

# Expõe porta (opcional, o bot não usa servidor HTTP)
# EXPOSE 3000

# Comando para iniciar o bot
CMD ["node", "dist/index.js"]
