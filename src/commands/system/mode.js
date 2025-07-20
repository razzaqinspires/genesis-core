// File: genesis-core/src/commands/system/mode.js
import { Logger } from 'metacognitive-nexus';

export default class ModeCommand {
    constructor(sock, aiNexus, taskScheduler, commandGuard, botConfig) {
        this.name = 'mode';
        this.description = 'Mengatur mode akses bot (self/public). Hanya Owner.';
        this.accessMode = 'self'; // Perintah ini hanya bisa diakses oleh bot itu sendiri atau owner
        this.sock = sock;
        this.aiNexus = aiNexus;
        this.botConfig = botConfig; // Diperlukan untuk mengubah mode konfigurasi
        Logger.debug(`[CommandLoader] Inisialisasi perintah: ${this.name}`);
    }

    async execute(msg, args) {
        const startTime = Date.now();
        const remoteJid = msg.key.remoteJid;
        const userId = msg.key.participant || msg.key.remoteJid;
        const platform = 'whatsapp';

        let success = false;
        let errorMessage = null;
        let responseText = '';

        // Validasi akses: Hanya owner yang boleh mengubah mode
        const ownerJids = [this.botConfig.get('botJid'), this.botConfig.get('ownerJid')].filter(Boolean);
        if (!ownerJids.includes(userId)) {
            errorMessage = 'Anda tidak memiliki izin untuk mengubah mode bot. Hanya Owner yang dapat mengakses perintah ini.';
            responseText = errorMessage;
            await this.sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
            Logger.warn(`[Command] !mode gagal: Akses ditolak untuk ${userId}.`);
            success = false;
        } else if (args.length < 1) {
            errorMessage = `Mode saat ini: *${this.botConfig.get('botAccessMode')}*. Gunakan: !mode <self|public>`;
            responseText = errorMessage;
            await this.sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
            Logger.warn(`[Command] !mode gagal: Argumen kurang.`);
            success = false;
        } else {
            const newMode = args[0].toLowerCase();
            if (newMode === 'self' || newMode === 'public') {
                await this.botConfig.set('botAccessMode', newMode);
                responseText = `Mode akses bot berhasil diubah menjadi: *${newMode}*.`;
                await this.sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
                Logger.info(`[Command] !mode berhasil: Mode diubah ke ${newMode} oleh ${userId}.`);
                success = true;
            } else {
                errorMessage = 'Mode tidak valid. Pilihan: self atau public.';
                responseText = errorMessage;
                await this.sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
                Logger.warn(`[Command] !mode gagal: Mode tidak valid '${newMode}'.`);
                success = false;
            }
        }
        
        await this.aiNexus.getNavigator().processInteraction({
            prompt: `User ${userId} executed !mode ${args.join(' ')}`,
            response: responseText,
            providerUsed: 'Internal Command',
            modelUsed: this.name,
            latencyMs: Date.now() - startTime,
            success: success,
            error: errorMessage ? new Error(errorMessage) : null,
            fallbackPath: [], userId: userId, platform: platform,
            promptMetadata: { type: 'command_execution', command: this.name, subCommand: args[0] }
        });
    }
}