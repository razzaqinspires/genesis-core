// File: genesis-core/src/commands/general/ping.js
import { Logger } from 'metacognitive-nexus';

export default class PingCommand {
    constructor(sock, aiNexus, taskScheduler, commandGuard, botConfig) { // Tambahkan botConfig
        this.name = 'ping';
        this.description = 'Membalas dengan Pong!';
        this.accessMode = 'public'; // Default: public
        this.antiSpam = true; 
        this.cooldown = 3;   
        this.sock = sock;
        this.aiNexus = aiNexus;
        this.botConfig = botConfig; // Tersedia jika diperlukan
        Logger.debug(`[CommandLoader] Inisialisasi perintah: ${this.name}`);
    }

    async execute(msg, args) {
        const startTime = Date.now();
        const remoteJid = msg.key.remoteJid;
        const userId = msg.key.participant || msg.key.remoteJid;
        const platform = 'whatsapp';

        let success = false;
        let errorMessage = null;
        let responseText = 'Pong!';

        try {
            await this.sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
            Logger.info(`[Command] !ping berhasil dari ${msg.pushName} (${remoteJid}).`);
            success = true;
        } catch (error) {
            errorMessage = error.message;
            responseText = `Maaf, terjadi kesalahan saat menjalankan *${this.name}*: ${errorMessage}`;
            Logger.error(`[Command] Error saat menjalankan !ping: ${errorMessage}`, error);
            await this.sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
            success = false;
        } finally {
            await this.aiNexus.getNavigator().processInteraction({
                prompt: `User executed !ping`,
                response: responseText,
                providerUsed: 'Internal Command',
                modelUsed: this.name,
                latencyMs: Date.now() - startTime,
                success: success,
                error: errorMessage ? new Error(errorMessage) : null,
                fallbackPath: [], userId: userId, platform: platform,
                promptMetadata: { type: 'command_execution', command: this.name }
            });
        }
    }
}