// File: genesis-core/src/commands/general/afk.js
import { Logger } from 'metacognitive-nexus';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const AFK_DATA_FILE = path.join(process.cwd(), 'data', 'afk_status.json');

// Catatan: Di masa depan, data AFK ini juga bisa disimpan di UCM Metacognitive Nexus
// agar AI memiliki pemahaman global tentang status pengguna.
class AfkManager {
    #afkUsers = new Map(); // userId -> { reason: string, since: Date, lastNotified: Map<notifierJid, Date> }
    #notificationCooldownMs = 60 * 60 * 1000; // Cooldown notifikasi per 1 jam per notifier
    #logger;

    constructor() {
        this.#logger = Logger;
        this.#loadAfkStatus().catch(err => this.#logger.error('[AfkManager] Gagal memuat status AFK.', err));
    }

    async #loadAfkStatus() {
        try {
            await fs.mkdir(path.dirname(AFK_DATA_FILE), { recursive: true });
            const data = await fs.readFile(AFK_DATA_FILE, 'utf8');
            const loaded = JSON.parse(data);
            for (const userId in loaded) {
                this.#afkUsers.set(userId, {
                    ...loaded[userId],
                    since: new Date(loaded[userId].since),
                    lastNotified: new Map(loaded[userId].lastNotified || []), // Re-hydrate Map
                });
            }
            this.#logger.info(`[AfkManager] Memuat ${this.#afkUsers.size} status AFK.`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                this.#logger.info('[AfkManager] File status AFK tidak ditemukan, memulai kosong.');
            } else {
                this.#logger.error('[AfkManager] Error memuat status AFK.', error);
            }
        }
    }

    async #saveAfkStatus() {
        try {
            const dataToSave = {};
            this.#afkUsers.forEach((value, key) => {
                dataToSave[key] = {
                    ...value,
                    lastNotified: Array.from(value.lastNotified), // Convert Map to Array for JSON
                };
            });
            await fs.writeFile(AFK_DATA_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
            this.#logger.debug('[AfkManager] Status AFK disimpan.');
        } catch (error) {
            this.#logger.error('[AfkManager] Gagal menyimpan status AFK.', error);
        }
    }

    setAfk(userId, reason) {
        this.#afkUsers.set(userId, {
            reason: reason,
            since: new Date(),
            lastNotified: new Map(), // Map untuk cooldown notifikasi per notifier
        });
        this.#saveAfkStatus();
        this.#logger.info(`[AfkManager] ${userId} sekarang AFK dengan alasan: ${reason}`);
    }

    removeAfk(userId) {
        const removed = this.#afkUsers.delete(userId);
        if (removed) {
            this.#saveAfkStatus();
            this.#logger.info(`[AfkManager] ${userId} tidak lagi AFK.`);
        }
        return removed;
    }

    getAfkStatus(userId) {
        return this.#afkUsers.get(userId) || null;
    }

    /**
     * Memeriksa dan memperbarui status notifikasi AFK untuk pengguna tertentu oleh pengirim tertentu.
     * @param {string} userId JID pengguna AFK.
     * @param {string} notifierJid JID pengguna yang mencoba berinteraksi (yang akan menerima notifikasi).
     * @returns {boolean} True jika notifikasi harus ditampilkan, false jika dalam cooldown notifikasi.
     */
    shouldNotifyAfk(userId, notifierJid) {
        const afkData = this.#afkUsers.get(userId);
        if (!afkData) return false;

        const now = Date.now();
        const lastNotifiedTime = afkData.lastNotified.get(notifierJid);

        if (!lastNotifiedTime || (now - lastNotifiedTime.getTime() > this.#notificationCooldownMs)) {
            afkData.lastNotified.set(notifierJid, new Date());
            this.#saveAfkStatus(); // Simpan perubahan lastNotified
            return true;
        }
        return false;
    }
}

const afkManager = new AfkManager(); // Singleton instance

export default class AfkCommand {
    constructor(sock, aiNexus, taskScheduler, commandGuard, botConfig) {
        this.name = 'afk';
        this.description = 'Mengatur status Away From Keyboard Anda. (!afk [alasan])';
        this.accessMode = 'public';
        this.antiSpam = true; // Bisa disetel anti-spam untuk mencegah penyalahgunaan
        this.cooldown = 5; // Cooldown singkat agar tidak spam diri sendiri
        this.sock = sock;
        this.aiNexus = aiNexus;
        this.botConfig = botConfig;
        this.afkManager = afkManager; // Menggunakan singleton AfkManager
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

        const currentAfkStatus = this.afkManager.getAfkStatus(userId);

        if (args.length === 0 && currentAfkStatus) {
            // Jika tidak ada argumen dan sudah AFK, berarti kembali
            this.afkManager.removeAfk(userId);
            responseText = 'Anda tidak lagi AFK. Selamat datang kembali!';
            await this.sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
            Logger.info(`[Command] ${userId} kembali dari AFK.`);
            success = true;
        } else if (args.length > 0) {
            // Jika ada argumen, set AFK
            const reason = args.join(' ').trim();
            this.afkManager.setAfk(userId, reason);
            responseText = `Anda sekarang AFK dengan alasan: *${reason}*. Bot akan memberitahu jika ada yang mencari Anda.`;
            await this.sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
            Logger.info(`[Command] ${userId} AFK dengan alasan: "${reason}".`);
            success = true;
        } else {
            // Jika tidak ada argumen dan tidak AFK
            errorMessage = 'Format perintah salah. Gunakan: !afk [alasan] atau !afk untuk kembali.';
            responseText = errorMessage;
            await this.sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
            Logger.warn(`[Command] !afk gagal: ${errorMessage}`);
            success = false;
        }

        await this.aiNexus.getNavigator().processInteraction({
            prompt: `User ${userId} executed !afk ${args.join(' ')}`,
            response: responseText,
            providerUsed: 'Internal Command', modelUsed: this.name,
            latencyMs: Date.now() - startTime, success: success, error: errorMessage ? new Error(errorMessage) : null,
            fallbackPath: [], userId: userId, platform: platform,
            promptMetadata: { type: 'command_execution', command: this.name, subCommand: args.length > 0 ? 'set' : 'remove' }
        });
    }
}