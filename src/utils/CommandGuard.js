// File: genesis-core/src/utils/CommandGuard.js
import { Logger } from 'metacognitive-nexus';

// Durasi default & ambang batas
const DEFAULT_COOLDOWN_SECONDS = 5; // Detik
const SPAM_THRESHOLD_MS = 1000;    // Jika 3 perintah dalam 1 detik dianggap spam
const SPAM_WARNING_LEVELS = [2, 4, 8]; // Setelah 2, 4, 8 deteksi spam, naik level
const SPAM_BLACKLIST_DURATIONS_MS = [
    5 * 60 * 1000,   // Level 1: 5 menit
    30 * 60 * 1000,  // Level 2: 30 menit
    60 * 60 * 1000,  // Level 3: 1 jam
    24 * 60 * 60 * 1000 // Level 4+: 24 jam
];

export class CommandGuard {
    #userCooldowns = new Map(); // Kunci: 'userId:commandName' -> { expiresAt: Date, notified: boolean }
    #userSpamDetectors = new Map(); // Kunci: 'userId' -> { lastCommands: [{timestamp, command}], warningLevel: 0, blacklistExpires: Date, notifiedBlacklist: boolean }
    #aiNexus;
    #botConfig;

    constructor(aiNexus, botConfig) {
        this.#aiNexus = aiNexus;
        this.#botConfig = botConfig;
        Logger.info('[CommandGuard] Perceptual Command Guard diinisialisasi.');
    }

    /**
     * Memeriksa apakah perintah dapat dijalankan berdasarkan cooldown dan anti-spam.
     * @param {string} userId ID unik pengguna.
     * @param {string} commandName Nama perintah.
     * @param {boolean} antiSpamEnabled Apakah anti-spam aktif untuk perintah ini.
     * @param {number} cooldownSeconds Cooldown spesifik perintah dalam detik.
     * @returns {{allowed: boolean, message?: string, cooldownRemaining?: number, blacklistRemaining?: number}}
     */
    async check(userId, commandName, antiSpamEnabled, cooldownSeconds) {
        const now = Date.now();

        // --- Anti-Spam Check ---
        if (antiSpamEnabled && this.#botConfig.get('antiSpamGlobal')) { // Tambahkan botConfig.antiSpamGlobal
            const spamData = this.#userSpamDetectors.get(userId) || { lastCommands: [], warningLevel: 0, blacklistExpires: null, notifiedBlacklist: false };

            // Periksa apakah pengguna sedang dalam blacklist
            if (spamData.blacklistExpires && now < spamData.blacklistExpires.getTime()) {
                const remaining = Math.ceil((spamData.blacklistExpires.getTime() - now) / 1000);
                if (!spamData.notifiedBlacklist) { // Hanya notifikasi sekali per blacklist
                    spamData.notifiedBlacklist = true;
                    this.#userSpamDetectors.set(userId, spamData);
                    Logger.warn(`[CommandGuard] Pengguna ${userId} diblokir spam level ${spamData.warningLevel}. Tersisa ${remaining} detik.`);
                    // Laporkan ke ManifoldNavigator
                    await this.#aiNexus.getNavigator().processInteraction({
                        prompt: `User ${userId} attempted command while blacklisted.`,
                        response: `Blocked for spam.`,
                        providerUsed: 'CommandGuard', modelUsed: 'AntiSpam',
                        latencyMs: 0, success: false, error: new Error('User blacklisted for spam'),
                        userId: userId, platform: 'whatsapp', promptMetadata: { type: 'spam_block' }
                    });
                    return { allowed: false, message: `Anda diblokir karena aktivitas spam. Coba lagi dalam ${remaining} detik.`, blacklistRemaining: remaining };
                }
                return { allowed: false, blacklistRemaining: remaining }; // Abaikan notifikasi berulang jika sudah diberitahu
            } else if (spamData.blacklistExpires && now >= spamData.blacklistExpires.getTime()) {
                // Blacklist expired, reset
                Logger.info(`[CommandGuard] Pengguna ${userId} blacklist spam kadaluarsa, reset.`);
                this.#userSpamDetectors.delete(userId); // Hapus seluruh data spam pengguna
                spamData.warningLevel = 0;
                spamData.blacklistExpires = null;
                spamData.notifiedBlacklist = false;
            }

            // Catat perintah terakhir
            spamData.lastCommands = spamData.lastCommands.filter(c => now - c.timestamp < SPAM_THRESHOLD_MS * 3); // Jaga riwayat 3x threshold
            spamData.lastCommands.push({ timestamp: now, command: commandName });

            // Deteksi pola spam
            const recentCommands = spamData.lastCommands.filter(c => now - c.timestamp < SPAM_THRESHOLD_MS);
            if (recentCommands.length >= 3) { // 3 perintah dalam SPAM_THRESHOLD_MS
                spamData.warningLevel++;
                const blacklistDuration = SPAM_BLACKLIST_DURATIONS_MS[Math.min(spamData.warningLevel - 1, SPAM_BLACKLIST_DURATIONS_MS.length - 1)];
                spamData.blacklistExpires = new Date(now + blacklistDuration);
                spamData.notifiedBlacklist = false; // Setel ulang untuk notifikasi blacklist

                this.#userSpamDetectors.set(userId, spamData);
                const remaining = Math.ceil(blacklistDuration / 1000);
                Logger.warn(`[CommandGuard] SPAM DETECTED: Pengguna ${userId} naik ke level ${spamData.warningLevel}. Diblokir selama ${remaining} detik.`);
                // Laporkan ke ManifoldNavigator
                 await this.#aiNexus.getNavigator().processInteraction({
                    prompt: `User ${userId} triggered spam detection level ${spamData.warningLevel}.`,
                    response: `Blocked for spam.`,
                    providerUsed: 'CommandGuard', modelUsed: 'AntiSpam',
                    latencyMs: 0, success: false, error: new Error(`Spam level ${spamData.warningLevel}`),
                    userId: userId, platform: 'whatsapp', promptMetadata: { type: 'spam_detection' }
                });
                return { allowed: false, message: `Aktivitas Anda terdeteksi sebagai spam level ${spamData.warningLevel}. Anda diblokir selama ${remaining} detik.`, blacklistRemaining: remaining };
            }
            this.#userSpamDetectors.set(userId, spamData);
        }

        // --- Cooldown Check ---
        const key = `${userId}:${commandName}`;
        const cooldownData = this.#userCooldowns.get(key);
        const effectiveCooldown = cooldownSeconds || DEFAULT_COOLDOWN_SECONDS;

        if (cooldownData && now < cooldownData.expiresAt.getTime()) {
            const remaining = Math.ceil((cooldownData.expiresAt.getTime() - now) / 1000);
            if (!cooldownData.notified) { // Hanya notifikasi sekali per cooldown
                cooldownData.notified = true;
                this.#userCooldowns.set(key, cooldownData);
                Logger.debug(`[CommandGuard] Cooldown aktif untuk ${key}. Tersisa ${remaining} detik. Notifikasi.`);
                return { allowed: false, message: `Perintah *${commandName}* dalam masa cooldown. Coba lagi dalam ${remaining} detik. Ketik */status* untuk info lebih lanjut.`, cooldownRemaining: remaining };
            }
            Logger.debug(`[CommandGuard] Cooldown aktif untuk ${key}. Tersisa ${remaining} detik. Abaikan notifikasi.`);
            return { allowed: false, cooldownRemaining: remaining }; // Abaikan notifikasi berulang
        }

        // Reset notifikasi jika cooldown sudah habis
        if (cooldownData && now >= cooldownData.expiresAt.getTime()) {
            cooldownData.notified = false;
            this.#userCooldowns.set(key, cooldownData);
        }

        // Jika lolos semua pemeriksaan, izinkan dan set cooldown baru
        this.#userCooldowns.set(key, { expiresAt: new Date(now + effectiveCooldown * 1000), notified: false });
        return { allowed: true };
    }

    /**
     * Mendapatkan status cooldown dan blacklist pengguna.
     * @param {string} userId
     * @returns {{cooldowns: object, spamStatus: object}}
     */
    getStatus(userId) {
        const now = Date.now();
        const cooldowns = {};
        this.#userCooldowns.forEach((data, key) => {
            if (key.startsWith(`${userId}:`)) {
                const commandName = key.split(':')[1];
                const remaining = Math.ceil((data.expiresAt.getTime() - now) / 1000);
                if (remaining > 0) {
                    cooldowns[commandName] = remaining;
                }
            }
        });

        const spamData = this.#userSpamDetectors.get(userId);
        let blacklistRemaining = 0;
        let blacklistLevel = 0;
        if (spamData && spamData.blacklistExpires && now < spamData.blacklistExpires.getTime()) {
            blacklistRemaining = Math.ceil((spamData.blacklistExpires.getTime() - now) / 1000);
            blacklistLevel = spamData.warningLevel;
        }

        return {
            cooldowns: cooldowns,
            spamStatus: {
                isBlacklisted: blacklistRemaining > 0,
                remaining: blacklistRemaining,
                level: blacklistLevel
            }
        };
    }
    
    // Perceptual Learning (akan dihubungkan ke ManifoldNavigator)
    async adjustThresholds(learningData) {
        Logger.warn('[CommandGuard] Penyesuaian ambang batas spam/cooldown otomatis belum diimplementasikan. Akan menggunakan data dari UCM.');
        // Contoh: Jika UCM menunjukkan pengguna sering spam saat bosan,
        // AI bisa menyesuaikan ambang batas untuk pengguna itu secara temporer.
        // Atau jika terlalu banyak false positive, longgarkan threshold.
    }
}