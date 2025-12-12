import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
  WASocket,
  WAMessage,
  proto,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode-terminal';
import pino from 'pino';
import { resolve } from 'path';

/**
 * Gerenciador do bot WhatsApp usando Baileys
 */
export class WhatsAppBot {
  private sock: WASocket | null = null;

  constructor() {
    // Construtor vazio - inicialização acontece no connect
  }

  /**
   * Conecta o bot ao WhatsApp
   */
  async connect(onMessage: (from: string, message: string) => Promise<void>): Promise<void> {
    try {
      const authFolder = resolve(__dirname, '../../auth');
      console.log('📁 Pasta de autenticação:', authFolder);

      // Busca a versão mais recente do Baileys
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`📦 Usando Baileys v${version.join('.')} ${isLatest ? '(latest)' : ''}`);

      // Carrega sessão salva ou cria nova
      const { state, saveCreds } = await useMultiFileAuthState(authFolder);

      // Cria conexão
      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 5000,
      });

      // Salva credenciais quando atualizadas
      this.sock.ev.on('creds.update', saveCreds);

      // Handler de erros de conexão
      this.sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        console.log('🔄 Status da conexão:', connection || 'aguardando...');

        // Mostra QR Code
        if (qr) {
          console.log('\n📱 Escaneie o QR Code abaixo com seu WhatsApp:\n');
          qrcode.generate(qr, { small: true });
          
          // Mostra o texto do QR code para sites geradores
          console.log('\n🔗 Se o QR code acima estiver quebrado, copie o texto abaixo:');
          console.log('━'.repeat(80));
          console.log(qr);
          console.log('━'.repeat(80));
          console.log('\n📌 Cole em: https://www.qr-code-generator.com/ ou https://goqr.me/');
          console.log('   Depois escaneie o QR code gerado pelo site!\n');
        }

        // Conectado
        if (connection === 'open') {
          console.log('✅ Bot conectado ao WhatsApp com sucesso!');
        }

        // Desconectado
        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          console.log('❌ Conexão fechada.');
          console.log('   Código:', statusCode);
          console.log('   Motivo:', lastDisconnect?.error?.message || 'desconhecido');
          console.log('   Reconectar:', shouldReconnect);

          if (shouldReconnect) {
            console.log('⏳ Aguardando 5 segundos antes de reconectar...\n');
            setTimeout(() => {
              this.connect(onMessage);
            }, 5000);
          } else {
            console.log('🛑 Sessão encerrada. Delete a pasta auth/ e reinicie o bot.\n');
          }
        }
      });

      // Handler de mensagens recebidas
      this.sock.ev.on('messages.upsert', async ({ messages }: { messages: WAMessage[] }) => {
        for (const msg of messages) {
          // Ignora mensagens do próprio bot
          if (msg.key.fromMe) continue;

          // Ignora notificações e mensagens de status
          if (!msg.message) continue;

          // Pega o remetente
          const from = msg.key.remoteJid!;

          // ⚠️ FILTRO RIGOROSO: Só processa mensagens de chats autorizados
          const allowedChats = process.env.ALLOWED_CHATS?.split(',').map(c => c.trim()).filter(c => c) || [];
          
          // Se há lista de permitidos, DEVE estar na lista
          if (allowedChats.length > 0) {
            if (!allowedChats.includes(from)) {
              // Ignora silenciosamente - NÃO processa, NÃO responde, NÃO loga (para não poluir)
              return;
            }
            // Se chegou aqui, está autorizado
            console.log(`✅ Mensagem AUTORIZADA de: ${from}`);
          } else {
            // Se não há filtro, mostra o ID para facilitar configuração
            if (from.endsWith('@g.us')) {
              console.log(`📱 Grupo (adicione no .env se quiser restringir): ${from}`);
            } else {
              console.log(`👤 Contato (adicione no .env se quiser restringir): ${from}`);
            }
          }

          // Extrai texto da mensagem
          const messageText = 
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            '';

          if (messageText) {
            console.log(`📩 Mensagem de ${from}: ${messageText}`);
            
            try {
              await onMessage(from, messageText);
            } catch (error) {
              console.error('❌ Erro ao processar mensagem:', error);
            }
          }
        }
      });

    } catch (error) {
      console.error('❌ Erro ao conectar:', error);
      throw error;
    }
  }

  /**
   * Envia mensagem de texto
   */
  async sendMessage(to: string, message: string): Promise<void> {
    if (!this.sock) {
      throw new Error('Bot não está conectado');
    }

    try {
      await this.sock.sendMessage(to, { text: message });
    } catch (error) {
      console.error('❌ Erro ao enviar mensagem:', error);
      // Não lança erro - apenas loga
    }
  }

  /**
   * Envia mensagem de resposta
   */
  async reply(to: string, message: string, quotedMessage?: any): Promise<void> {
    if (!this.sock) {
      throw new Error('Bot não está conectado');
    }

    await this.sock.sendMessage(to, {
      text: message
    }, quotedMessage ? { quoted: quotedMessage } : {});
  }
}
