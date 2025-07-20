// File: genesis-core/src/commands/general/status.js
import { Logger } from 'metacognitive-nexus';

export default class StatusCommand {
    constructor(sock, aiNexus, taskScheduler, commandGuard, botConfig) { // Tambahkan botConfig
        this.name = 'status';
        this.description = 'Menampilkan status cooldown dan blacklist Anda.';
        this.accessMode = 'public'; // Default: public
        this.antiSpam = false; 
        this.cooldown = 0; 
        this.sock = sock;
        this.aiNexus = aiNexus;
        this.commandGuard = commandGuard;
        this.botConfig = botConfig; // Tersedia jika diperlukan
        Logger.debug(`[CommandLoader] Inisialisasi perintah: ${this.name}`);
    }

    async execute(msg, args) {
        const startTime = Date.now();
        const remoteJid = msg.key.remoteJid;
        const userId = msg.key.participant || msg.key.remoteJid;
        const platform = 'whatsapp';

        let success = true; // Asumsikan berhasil kecuali ada error
        let errorMessage = null;
        let statusMessage = '';

        try {
            const userStatus = this.commandGuard.getStatus(userId);
            
            statusMessage = `*Status Anda:*\n\n`;

            // Status Cooldown
            if (Object.keys(userStatus.cooldowns).length > 0) {
                statusMessage += 'Perintah dalam Cooldown:\n';
                for (const cmd in userStatus.cooldowns) {
                    statusMessage += `- *!${cmd}*: ${userStatus.cooldowns[cmd]} detik tersisa\n`;
                }
            } else {
                statusMessage += 'Tidak ada perintah dalam cooldown.\n';
            }

            statusMessage += '\n';

            // Status Anti-Spam (Blacklist)
            if (userStatus.spamStatus.isBlacklisted) {
                statusMessage += `Anda *diblokir* karena aktivitas spam (Level ${userStatus.spamStatus.level}).\n`;
                statusMessage += `Pembekuan tersisa: ${userStatus.spamStatus.remaining} detik.\n`;
            } else {
                statusMessage += 'Tidak diblokir karena aktivitas spam.\n';
            }

            statusMessage += `\nMode Bot Global: *${this.botConfig.get('botAccessMode')}*\n`;
            statusMessage += `Owner Bot: *${this.botConfig.get('ownerJid') || 'Belum diatur'}*\n`;

            await this.sock.sendMessage(remoteJid, { text: statusMessage }, { quoted: msg });
            Logger.info(`[Command] !status dari ${msg.pushName} (${remoteJid}).`);

        } catch (error) {
            errorMessage = error.message;
            statusMessage = `Maaf, terjadi kesalahan saat mengambil status: ${errorMessage}`;
            Logger.error(`[Command] Error saat menjalankan !status: ${errorMessage}`, error);
            await this.sock.sendMessage(remoteJid, { text: statusMessage }, { quoted: msg });
            success = false;
        } finally {
            await this.aiNexus.getNavigator().processInteraction({
                prompt: `User checked status.`,
                response: statusMessage,
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