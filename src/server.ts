import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { MessageHandler } from './bot/messageHandler';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

const messageHandler = new MessageHandler();

// Autenticação
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'finance123';

app.post('/auth/login', (req, res) => {
  const { password } = req.body;
  
  if (password === AUTH_PASSWORD) {
    // Gera um token simples (timestamp + senha hash)
    const token = Buffer.from(`${Date.now()}:${AUTH_PASSWORD}`).toString('base64');
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, message: 'Senha incorreta' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('🔌 Cliente tentando conectar:', socket.id);

  // Validação de autenticação
  const token = socket.handshake.auth.token;
  
  if (!token) {
    console.log('❌ Conexão rejeitada: sem token');
    socket.disconnect();
    return;
  }

  // Valida token
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const [, password] = decoded.split(':');
    
    if (password !== AUTH_PASSWORD) {
      console.log('❌ Conexão rejeitada: token inválido');
      socket.disconnect();
      return;
    }
  } catch (error) {
    console.log('❌ Conexão rejeitada: erro ao validar token');
    socket.disconnect();
    return;
  }

  console.log('✅ Cliente autenticado:', socket.id);

  // Envia mensagem de boas-vindas
  socket.emit('bot-message', {
    id: Date.now().toString(),
    text: '🤖 Bot de Controle Financeiro conectado! Digite "ajuda" ou "?" para ver os comandos disponíveis.',
    sender: 'bot',
    timestamp: new Date().toISOString()
  });

  // Recebe mensagem do usuário
  socket.on('user-message', async (data: { text: string }) => {
    console.log('📨 Mensagem recebida:', data.text);

    try {
      // Processa a mensagem
      const response = await messageHandler.handleMessage(data.text);

      // Envia resposta do bot
      socket.emit('bot-message', {
        id: Date.now().toString(),
        text: response,
        sender: 'bot',
        timestamp: new Date().toISOString()
      });

      console.log('✅ Resposta enviada');
    } catch (error) {
      console.error('❌ Erro ao processar mensagem:', error);
      
      socket.emit('bot-message', {
        id: Date.now().toString(),
        text: '❌ Erro ao processar sua mensagem. Tente novamente.',
        sender: 'bot',
        timestamp: new Date().toISOString()
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Cliente desconectado:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🌐 Frontend deve conectar em: http://localhost:${PORT}`);
});

export { app, httpServer, io };
