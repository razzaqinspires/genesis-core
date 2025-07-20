// File: genesis-core/src/commands/system/setowner.js
import { Logger } from 'metacognitive-nexus';

export default class SetOwnerCommand {
    constructor(sock, aiNexus, taskScheduler, commandGuard, botConfig) {
        this.name = 'setowner';
        this.description = 'Mengatur JID owner bot. Hanya Bot Self-Access.';
        this.accessMode = 'self'; // Hanya bisa diakses oleh bot itu sendiri
        this.sock = sock;
        this.aiNexus = aiNexus;
        this.botConfig = botConfig;
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

        // Validasi akses: Hanya jika bot itu sendiri yang menjalankan (melalui scan QR/pairing)
        if (userId !== this.botConfig.get('botJid')) {
            errorMessage = 'Perintah ini hanya dapat dijalankan oleh bot itu sendiri untuk alasan keamanan.';
            responseText = errorMessage;
            await this.sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
            Logger.warn(`[Command] !setowner gagal: Akses ditolak untuk ${userId}.`);
            success = false;
        } else if (args.length < 1) {
            errorMessage = `Owner saat ini: *${this.botConfig.get('ownerJid') || 'Belum diatur'}*. Gunakan: !setowner <JID_Owner>`;
            responseText = errorMessage;
            await this.sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
            Logger.warn(`[Command] !setowner gagal: Argumen kurang.`);
            success = false;
        } else {
            const newOwnerJid = args[0];
            // Tambahkan validasi JID di sini jika diperlukan
            await this.botConfig.set('ownerJid', newOwnerJid);
            responseText = `JID Owner berhasil diatur menjadi: *${newOwnerJid}*.`;
            await this.sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
            Logger.info(`[Command] !setowner berhasil: Owner diatur ke ${newOwnerJid}.`);
            success = true;
        }
        
        await this.aiNexus.getNavigator().processInteraction({
            prompt: `User ${userId} executed !setowner ${args.join(' ')}`,
            response: responseText,
            providerUsed: 'Internal Command', modelUsed: this.name,
            latencyMs: Date.now() - startTime, success: success, error: errorMessage ? new Error(errorMessage) : null,
            fallbackPath: [], userId: userId, platform: platform,
            promptMetadata: { type: 'command_execution', command: this.name, subCommand: args[0] }
        });
    }
}