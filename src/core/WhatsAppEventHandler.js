// File: genesis-core/src/core/WhatsAppEventHandler.js
import { Boom } from '@hapi/boom';
import { jidNormalizedUser, isJidGroup, jidDecode } from '@whiskeysockets/baileys';
import { CommandLoader } from './CommandLoader.js';
import { botConfig } from '../config/botConfig.js';
import { Logger } from 'metacognitive-nexus'; // Menggunakan Logger dari metacognitive-nexus
import { CommandGuard } from '../utils/CommandGuard.js'; // Import CommandGuard
// Import AfkManager secara eksplisit karena digunakan langsung di sini
import AfkCommand from '../commands/general/afk.js'; 

// Dapatkan instance singleton AfkManager yang digunakan oleh AfkCommand
const afkManager = new AfkCommand().afkManager; 

export class WhatsAppEventHandler {
    #sock;
    #aiNexus;
    #commandLoader;
    #botConfig;
    #commandGuard; 
    #messageHandlers = []; // Placeholder untuk handler pesan non-perintah di masa depan

    /**
     * Menginisialisasi WhatsAppEventHandler.
     * @param {object} sock Baileys socket instance.
     * @param {object} aiNexus MetacognitiveNexus instance.
     * @param {CommandLoader} commandLoader CommandLoader instance.
     * @param {object} botConfigInstance BotConfig instance.
     * @param {CommandGuard} commandGuardInstance CommandGuard instance.
     */
    constructor(sock, aiNexus, commandLoader, botConfigInstance, commandGuardInstance) {
        this.#sock = sock;
        this.#aiNexus = aiNexus;
        this.#commandLoader = commandLoader;
        this.#botConfig = botConfigInstance;
        this.#commandGuard = commandGuardInstance;
        this.#initializeListeners();
    }

    #initializeListeners() {
        // Listener untuk pembaruan status koneksi Baileys
        this.#sock.ev.on('connection.update', async (update) => {
            if (update.qr) {
                Logger.info('Silakan pindai QR Code ini:', update.qr);
            }
            if (update.connection === 'open') {
                Logger.info('Koneksi WhatsApp terbuka dan stabil.');
                // Mengatur JID bot ke konfigurasi persisten setelah koneksi berhasil
                await this.#botConfig.setBotJid(jidNormalizedUser(this.#sock.user.id));
                Logger.info(`[WhatsAppEventHandler] Bot JID: ${this.#botConfig.get('botJid')}`);
            }
            if (update.connection === 'close') {
                // Menentukan apakah bot harus mencoba menyambung ulang
                const shouldReconnect = (update.lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                Logger.info(`Koneksi ditutup: ${update.lastDisconnect?.error?.message}, menyambung ulang: ${shouldReconnect}`);
                if (shouldReconnect) {
                    await new Promise(resolve => setTimeout(resolve, 3000)); // Jeda sebelum keluar
                    // Keluar dari proses; service manager (misal PM2) diharapkan akan me-restart bot
                    process.exit(1); 
                } else {
                    Logger.error('Koneksi terputus secara permanen (logged out). Silakan hapus sesi dan mulai ulang.');
                    process.exit(1);
                }
            }
        });

        // Listener utama untuk pesan masuk atau pembaruan pesan
        this.#sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return; // Hanya proses notifikasi pesan baru

            for (const msg of messages) {
                // Abaikan pesan tanpa konten atau pesan yang dikirim oleh bot itu sendiri
                if (!msg.message || msg.key.fromMe) continue;

                const senderJid = msg.key.remoteJid; // JID grup atau kontak pengirim
                const isGroup = isJidGroup(senderJid);
                const senderDisplayName = msg.pushName || senderJid.split('@')[0]; // Nama tampilan pengirim
                const messageText = this.#getMessageContent(msg); // Konten teks dari pesan

                const userId = msg.key.participant || msg.key.remoteJid; // JID pengguna yang mengirim pesan (untuk AFK, CommandGuard)
                const botJid = this.#botConfig.get('botJid'); // JID bot dari konfigurasi persisten
                const ownerJid = this.#botConfig.get('ownerJid'); // JID owner dari konfigurasi persisten

                // Deteksi mention bot di pesan
                const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const botMentioned = botJid && mentionedJids.includes(botJid); // Pastikan botJid tidak null sebelum cek mention

                Logger.debug(`[WhatsAppEventHandler] Pesan dari ${senderDisplayName} (${senderJid}): "${messageText}"`);

                let shouldBotRespond = false;
                let contextMessage = messageText; // Teks yang akan diberikan ke AI sebagai konteks percakapan

                const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant; // JID dari pengirim pesan yang di-reply

                // --- Penanganan AFK: Deteksi mention/reply ke pengguna yang sedang AFK ---
                // Ini harus diproses sebelum logika respons bot utama untuk memprioritaskan notifikasi AFK.
                let afkNotified = false;
                // Kumpulkan semua JID yang di-mention dan JID yang di-reply
                const mentionedAndQuotedParticipants = new Set([...mentionedJids]);
                if (quotedParticipant) mentionedAndQuotedParticipants.add(quotedParticipant);
                
                for (const targetJid of mentionedAndQuotedParticipants) {
                    if (targetJid === botJid) continue; // Abaikan jika targetnya adalah bot itu sendiri
                    
                    const afkStatus = afkManager.getAfkStatus(targetJid);
                    if (afkStatus) {
                        const remainingTimeMs = Date.now() - afkStatus.since.getTime();
                        const afkDuration = this.#formatDuration(remainingTimeMs);

                        // Gunakan CommandGuard untuk menerapkan cooldown/anti-spam pada notifikasi AFK itu sendiri
                        const afkNotifyGuardKey = `afk_notify_${targetJid}`; // Kunci unik per pengguna AFK
                        const afkNotifyGuardResult = await this.#commandGuard.check(
                            senderJid, // Pengirim notifikasi adalah pengguna yang men-tag/me-reply
                            afkNotifyGuardKey, // Nama 'perintah' unik untuk guard notifikasi AFK ini
                            true, // Anti-spam diaktifkan untuk notifikasi AFK
                            3600 // Cooldown notifikasi 1 jam (3600 detik) per pengirim per pengguna AFK
                        );

                        if (afkNotifyGuardResult.allowed) {
                            // Minta Metacognitive Nexus (AI) untuk membuat pesan notifikasi AFK yang dinamis
                            const afkNotificationPrompt = `Buat pesan notifikasi singkat dan ramah untuk memberi tahu bahwa pengguna ${targetJid.split('@')[0]} sedang AFK sejak ${afkDuration} lalu dengan alasan: "${afkStatus.reason}". Pesan ini akan dikirim sebagai notifikasi otomatis.`;
                            const aiAfkResponse = await this.#aiNexus.getAIResponse(afkNotificationPrompt, {
                                userId: 'system_afk_notifier', // User ID internal untuk sistem AFK
                                platform: 'internal_afk_check',
                                showUserError: false // Notifikasi ini tidak boleh menampilkan error dari LLM ke pengguna
                            });

                            if (aiAfkResponse) {
                                await this.#sock.sendMessage(senderJid, { text: aiAfkResponse }, { quoted: msg });
                                Logger.info(`[AFK] Notifikasi AFK cerdas terkirim untuk ${targetJid} ke ${senderJid}.`);
                                afkNotified = true;
                            } else {
                                // Fallback jika AI gagal membuat pesan notifikasi
                                await this.#sock.sendMessage(senderJid, { text: `Pengguna yang Anda cari (${targetJid.split('@')[0]}) sedang AFK sejak ${afkDuration} lalu dengan alasan: "${afkStatus.reason}".` }, { quoted: msg });
                                Logger.warn(`[AFK] Notifikasi AFK fallback terkirim untuk ${targetJid}.`);
                                afkNotified = true;
                            }
                        } else {
                            Logger.debug(`[AFK] Notifikasi AFK untuk ${targetJid} diblokir untuk ${senderJid} (cooldown/spam notifikasi).`);
                        }
                    }
                }
                // Jika notifikasi AFK sudah terkirim, abaikan pemrosesan pesan lebih lanjut
                if (afkNotified) return; 

                // --- Logika Penentuan Kapan Bot Harus Merespons (Reply & Mention) ---
                if (quotedMessage) {
                    // Kasus 1: Pengguna mereply pesan bot itu sendiri
                    if (quotedParticipant === botJid) { 
                        shouldBotRespond = true;
                        contextMessage = messageText; // Fokus pada pesan pengguna saat ini
                        Logger.debug(`[WhatsAppEventHandler] Bot di-reply langsung oleh ${senderDisplayName}.`);
                    } 
                    // Kasus 3 & 4: Pengguna mereply pesan lain DAN me-mention bot (di grup)
                    else if (isGroup && botMentioned) {
                        shouldBotRespond = true;
                        const originalQuotedText = this.#getQuotedMessageContent(quotedMessage);
                        
                        // Cek untuk 'quoted dalam quoted' (pesan yang di-reply, juga me-reply pesan lain)
                        const deepQuoted = quotedMessage.extendedTextMessage?.contextInfo?.quotedMessage;
                        const deepQuotedParticipant = quotedMessage.extendedTextMessage?.contextInfo?.participant;

                        if (deepQuoted && deepQuotedParticipant) {
                            // Kasus 4: Quoted dalam quoted, dengan bot mention. Bot akan membaca seluruh alur konteks.
                            const deepQuotedText = this.#getQuotedMessageContent(deepQuoted);
                            const deepQuotedSenderName = jidDecode(deepQuotedParticipant)?.user || 'Pengguna Lain';
                            const quotedSenderName = jidDecode(quotedParticipant)?.user || 'Pengguna Lain';
                            
                            contextMessage = `Percakapan sebelumnya dari ${deepQuotedSenderName}: "${deepQuotedText}". Kemudian ${quotedSenderName} membalas: "${originalQuotedText}". Lalu Anda (@Bot) mengatakan: "${messageText}"`;
                            Logger.debug(`[WhatsAppEventHandler] Quoted dalam quoted, dengan bot mention. Konteks dalam: ${contextMessage}`);
                        } else {
                            // Kasus 3: Reply ke non-bot, dengan bot mention.
                            const quotedSenderName = jidDecode(quotedParticipant)?.user || 'Pengguna Lain';
                            contextMessage = `Merespons pesan dari ${quotedSenderName}: "${originalQuotedText}". Anda (@Bot) mengatakan: "${messageText}"`;
                            Logger.debug(`[WhatsAppEventHandler] Reply ke non-bot dengan bot mention. Konteks: ${contextMessage}`);
                        }
                    }
                    // Kasus 2: Reply ke non-bot, tanpa mention bot. Abaikan.
                    else {
                        Logger.debug(`[WhatsAppEventHandler] Reply ke non-bot, tidak ada mention ke bot. Abaikan.`);
                        return; // Abaikan pesan yang tidak relevan dengan bot
                    }
                } 
                // Kasus: Tidak ada reply, tapi di grup dan me-mention bot
                else if (isGroup && botMentioned) {
                    shouldBotRespond = true;
                    Logger.debug(`[WhatsAppEventHandler] Bot di-mention langsung oleh ${senderDisplayName}.`);
                }
                // Kasus: Pesan pribadi ke bot (selalu respons)
                else if (!isGroup) {
                    shouldBotRespond = true;
                    Logger.debug(`[WhatsAppEventHandler] Pesan pribadi ke bot dari ${senderDisplayName}.`);
                }
                // Jika tidak ada kondisi di atas yang terpenuhi, abaikan pesan.
                else {
                    Logger.debug(`[WhatsAppEventHandler] Tidak ada kondisi respon terpenuhi. Abaikan.`);
                    return;
                }

                // --- Validasi Mode Akses Bot (self/public) ---
                const botAccessMode = this.#botConfig.get('botAccessMode');
                const isOwner = userId === ownerJid;
                const isBotSelf = userId === botJid;

                if (botAccessMode === 'self') {
                    // Dalam mode 'self', hanya owner atau bot itu sendiri yang punya akses
                    if (!isOwner && !isBotSelf) {
                        Logger.info(`[WhatsAppEventHandler] Bot dalam mode 'self', menolak akses untuk ${senderDisplayName}.`);
                        // Opsional: kirim notifikasi bahwa bot sedang dalam mode self kepada pengguna
                        // await this.#sock.sendMessage(senderJid, { text: 'Maaf, saya sedang dalam mode privat dan hanya merespons Owner atau diri saya sendiri.' });
                        return;
                    }
                } else if (botAccessMode === 'public') {
                    // Dalam mode 'public', bot tidak boleh merespons pesan dari dirinya sendiri (kecuali dia ownernya)
                    // Ini untuk mencegah loop atau perilaku aneh jika bot berinteraksi dengan pesan-pesannya sendiri.
                    if (isBotSelf && !isOwner) { 
                         Logger.info(`[WhatsAppEventHandler] Bot dalam mode 'public', menolak akses diri sendiri (kecuali Owner).`);
                         return;
                    }
                }
                
                // --- Proses Pesan sebagai Perintah atau Respon AI Umum ---
                // Coba proses pesan sebagai perintah terlebih dahulu.
                let handledByCommand = await this.#processCommand(messageText, msg, senderJid, senderDisplayName);

                // Jika pesan tidak ditangani oleh perintah DAN bot harus merespons (berdasarkan logika di atas)
                if (!handledByCommand && shouldBotRespond) {
                    await this.#processAIResponse(contextMessage, msg, senderJid, userId, platform);
                } else if (handledByCommand) {
                    // Jika pesan adalah perintah dan berhasil diproses (atau diblokir oleh CommandGuard),
                    // AI tidak akan merespons lagi untuk menghindari duplikasi atau loop.
                    Logger.debug(`[WhatsAppEventHandler] Pesan ditangani oleh perintah. AI tidak akan merespons AI response.`);
                }
            }
        });
    }

    /**
     * Mengekstrak konten teks dari berbagai jenis pesan Baileys.
     * @param {object} msg Pesan Baileys.
     * @returns {string} Konten teks pesan.
     */
    #getMessageContent(msg) {
        if (msg.message?.extendedTextMessage?.text) return msg.message.extendedTextMessage.text;
        if (msg.message?.conversation) return msg.message.conversation;
        if (msg.message?.imageMessage?.caption) return msg.message.imageMessage.caption;
        if (msg.message?.videoMessage?.caption) return msg.message.videoMessage.caption;
        // Tambahkan jenis pesan lain jika diperlukan (misal: documentMessage, audioMessage)
        return '';
    }

    /**
     * Mengekstrak konten teks dari pesan yang di-quote (dibalas).
     * @param {object} quotedMessage Objek pesan yang di-quote.
     * @returns {string} Konten teks pesan yang di-quote.
     */
    #getQuotedMessageContent(quotedMessage) {
        if (quotedMessage?.extendedTextMessage?.text) return quotedMessage.extendedTextMessage.text;
        if (quotedMessage?.conversation) return quotedMessage.conversation;
        if (quotedMessage?.imageMessage?.caption) return quotedMessage.imageMessage.caption;
        if (quotedMessage?.videoMessage?.caption) return quotedMessage.videoMessage.caption;
        return '';
    }

    /**
     * Memformat durasi dalam milidetik menjadi string yang mudah dibaca.
     * Digunakan untuk notifikasi AFK.
     * @param {number} ms Durasi dalam milidetik.
     * @returns {string} Durasi terformat (misal: "2 hari 5 jam 30 menit").
     */
    #formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        const parts = [];
        if (days > 0) parts.push(`${days} hari`);
        if (hours > 0) parts.push(`${hours % 24} jam`); // sisa jam setelah dihitung hari
        if (minutes > 0 && days === 0) parts.push(`${minutes % 60} menit`); // menit hanya jika belum ada hari
        if (seconds > 0 && hours === 0 && days === 0) parts.push(`${seconds % 60} detik`); // detik hanya jika belum ada jam/hari

        if (parts.length === 0) return 'beberapa saat';
        return parts.join(' ');
    }

    /**
     * Memproses pesan sebagai perintah, termasuk pemeriksaan prefiks dan CommandGuard.
     * @param {string} messageText Teks pesan asli.
     * @param {object} msg Objek pesan Baileys.
     * @param {string} senderJid JID pengirim.
     * @param {string} senderDisplayName Nama tampilan pengirim.
     * @returns {Promise<boolean>} True jika pesan adalah perintah dan berhasil ditangani/diblokir, false jika bukan perintah.
     */
    async #processCommand(messageText, msg, senderJid, senderDisplayName) {
        const lowerCaseText = messageText.toLowerCase();
        const prefixMode = this.#botConfig.get('prefixMode');
        const prefixes = this.#botConfig.get('prefixes');
        const userId = msg.key.participant || msg.key.remoteJid;

        let cleanMessage = messageText;
        let commandName = '';
        let commandArgs = [];
        let prefixMatched = false;

        // Logika Mode Prefiks
        if (prefixMode === 'multi' || prefixMode === 'single') {
            for (const prefix of prefixes) {
                if (lowerCaseText.startsWith(prefix)) {
                    cleanMessage = messageText.substring(prefix.length).trim();
                    prefixMatched = true;
                    break;
                }
            }
            // Jika dalam mode prefiks tapi tidak ada yang cocok, ini bukan perintah
            if (!prefixMatched) return false;
        } else if (prefixMode === 'none') {
            // Dalam mode 'none', kita asumsikan seluruh pesan mungkin adalah nama perintah.
            // Jika tidak ada CommandClass yang cocok, akan diteruskan ke AI response.
        }

        const parts = cleanMessage.split(' ');
        commandName = parts[0];
        commandArgs = parts.slice(1);

        const command = this.#commandLoader.getCommand(commandName);

        if (command) {
            // --- Validasi Akses Perintah berdasarkan accessMode ---
            const botJid = this.#botConfig.get('botJid');
            const ownerJid = this.#botConfig.get('ownerJid');
            const isOwner = userId === ownerJid;
            const isBotSelf = userId === botJid;

            if (command.accessMode === 'self') {
                // Hanya owner atau bot itu sendiri yang boleh mengakses perintah 'self'
                if (!isOwner && !isBotSelf) {
                    Logger.warn(`[CommandAccess] Perintah '${command.name}' ditolak untuk ${userId} (mode 'self' akses).`);
                    if (this.#botConfig.get('userNotificationLevel') === 'verbose') {
                        await this.#sock.sendMessage(senderJid, { text: 'Maaf, perintah ini hanya dapat diakses oleh Owner bot.' }, { quoted: msg });
                    }
                    return true; // Dianggap ditangani karena akses ditolak
                }
            } else if (command.accessMode === 'public') {
                // Untuk perintah 'public', bot tidak dapat memanggil dirinya sendiri (kecuali jika ia juga owner)
                if (isBotSelf && !isOwner) {
                    Logger.warn(`[CommandAccess] Perintah '${command.name}' ditolak untuk bot sendiri (mode 'public' akses).`);
                    return true; // Dianggap ditangani karena bot tidak boleh memanggil perintah public-nya sendiri
                }
            }

            // --- Integrasi CommandGuard: Anti-Spam & Cooldown ---
            const guardResult = await this.#commandGuard.check(
                userId, 
                command.name, 
                command.antiSpam || false, // Properti opsional antiSpam dari Command Class
                command.cooldown || 0     // Properti opsional cooldown dari Command Class
            );

            if (!guardResult.allowed) {
                // Hanya kirim notifikasi jika CommandGuard memberikan pesan dan level notifikasi bot memungkinkan
                if (guardResult.message && this.#botConfig.get('userNotificationLevel') === 'verbose') {
                    await this.#sock.sendMessage(senderJid, { text: guardResult.message }, { quoted: msg });
                }
                Logger.warn(`[CommandGuard] Perintah '${command.name}' diblokir untuk ${userId}. Alasan: ${guardResult.message || 'Tidak ada notifikasi eksplisit.'}`);
                return true; // Perintah terdeteksi dan diblokir, jadi dianggap "ditangani"
            }

            Logger.info(`[WhatsAppEventHandler] Menjalankan perintah '${commandName}' dari ${senderDisplayName}.`);
            try {
                // Jalankan perintah
                await command.execute(msg, commandArgs, this.#sock);
            } catch (error) {
                Logger.error(`[WhatsAppEventHandler] Error saat menjalankan perintah '${commandName}': ${error.message}`, error);
                await this.#sock.sendMessage(senderJid, { text: `Maaf, terjadi kesalahan saat menjalankan *${commandName}*: ${error.message}` }, { quoted: msg });
            }
            return true; // Perintah ditemukan dan dijalankan (atau diblokir)
        }
        return false; // Bukan perintah
    }

    /**
     * Memproses pesan sebagai respons AI menggunakan Metacognitive Nexus.
     * @param {string} contextText Teks konteks yang akan diberikan ke AI.
     * @param {object} msg Objek pesan Baileys.
     * @param {string} senderJid JID pengirim.
     * @param {string} userId ID pengguna (dianonimkan).
     * @param {string} platform Platform interaksi (misal: 'whatsapp_group', 'whatsapp_private').
     * @returns {Promise<void>}
     */
    async #processAIResponse(contextText, msg, senderJid, userId, platform) {
        // Kirim notifikasi "AI sedang berpikir..."
        await this.#sock.sendMessage(senderJid, { text: 'AI sedang berpikir... 🧠' }, { quoted: msg });

        const aiResponse = await this.#aiNexus.getAIResponse(contextText, {
            userId: userId,
            platform: platform,
            // Menentukan apakah pesan error user-friendly akan ditampilkan berdasarkan konfigurasi bot
            showUserError: this.#botConfig.get('userNotificationLevel') === 'verbose', 
            devErrorHandler: (error) => {
                // Log error detail untuk developer
                Logger.error(`[DEV_ERROR] AI Request Failed for ${userId}: ${error.message}`, error);
                // Di sini Anda dapat menambahkan integrasi dengan sistem notifikasi developer eksternal
                // (misal: Sentry, email, webhook) untuk error-error AI yang serius.
            }
        });

        if (aiResponse) {
            await this.#sock.sendMessage(senderJid, { text: aiResponse }, { quoted: msg });
        } else {
            // Jika aiResponse null, ini berarti Metacognitive Nexus tidak dapat memberikan respons.
            // Pesan error ke user sudah ditangani oleh Metacognitive Nexus jika `showUserError` true.
            // Jika `showUserError` false, tidak ada respons ke user, hanya log ke dev.
            Logger.debug(`[WhatsAppEventHandler] Tidak ada respons AI dari Nexus. Kemungkinan AI sedang tidur atau error. User Notification: ${this.#botConfig.get('userNotificationLevel') === 'verbose' ? 'Sent' : 'Suppressed'}`);
        }
    }
}