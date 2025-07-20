// File: genesis-core/src/tasks/dailyGreeting.js
// Menggunakan Logger dari metacognitive-nexus
import { Logger } from 'metacognitive-nexus';

export default class DailyGreetingTask {
    constructor(sock, aiNexus) {
        this.name = 'dailyGreeting';
        this.description = 'Mengirim sapaan harian ke grup tertentu.';
        this.sock = sock;
        this.aiNexus = aiNexus;
        Logger.debug(`[TaskLoader] Inisialisasi tugas: ${this.name}`);
    }

    async execute(metadata) {
        const targetJid = metadata.targetJid || '12345@g.us'; // Ganti dengan JID grup target
        const greetingPrompt = "Buat sapaan pagi yang ramah untuk komunitas bot AI.";

        Logger.info(`[Task] Menjalankan DailyGreetingTask untuk ${targetJid}.`);

        try {
            const aiGreeting = await this.aiNexus.getAIResponse(greetingPrompt, {
                userId: 'system_task_daily_greeting',
                platform: 'internal_schedule',
                showUserError: false
            });

            if (aiGreeting) {
                await this.sock.sendMessage(targetJid, { text: aiGreeting });
                Logger.info(`[Task] Sapaan harian terkirim ke ${targetJid}.`);
            } else {
                Logger.warn(`[Task] Gagal mendapatkan sapaan AI, tidak dapat mengirim pesan ke ${targetJid}.`);
            }
        } catch (error) {
            Logger.error(`[Task] Error saat mengirim sapaan harian ke ${targetJid}: ${error.message}`, error);
        }
    }
}