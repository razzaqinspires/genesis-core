// File: genesis-core/src/commands/ai/ask.js
import { Logger } from 'metacognitive-nexus';

export default class AskCommand {
    constructor(sock, aiNexus, taskScheduler, commandGuard, botConfig) {
        this.name = 'ask';
        this.description = 'Meminta AI untuk menjawab pertanyaan atau menghasilkan teks. (!ask [pertanyaan])';
        this.accessMode = 'public';
        this.antiSpam = true; 
        this.cooldown = 10; // Cooldown untuk AI response
        this.sock = sock;
        this.aiNexus = aiNexus;
        this.botConfig = botConfig;
        Logger.debug(`[CommandLoader] Inisialisasi perintah: ${this.name}`);
    }

    async execute(msg, args) {
        const startTime = Date.now();
        const prompt = args.join(' ').trim();
        const remoteJid = msg.key.remoteJid;
        const userId = msg.key.participant || msg.key.remoteJid;
        const platform = 'whatsapp';

        let success = false;
        let errorMessage = null;
        let responseText = '';

        if (!prompt) {
            errorMessage = 'Mohon berikan pertanyaan setelah perintah.';
            responseText = errorMessage;
            await this.sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
            Logger.warn(`[Command] !ask gagal: ${errorMessage}`);
            success = false;
        } else {
            await this.sock.sendMessage(remoteJid, { text: 'AI sedang berpikir... 🧠' }, { quoted: msg });
            try {
                const aiResponse = await this.aiNexus.getAIResponse(prompt, {
                    userId: userId,
                    platform: platform,
                    showUserError: this.botConfig.get('userNotificationLevel') === 'verbose',
                    devErrorHandler: (error) => {
                        Logger.error(`[DEV_ERROR] AI Request Failed for ${userId}: ${error.message}`, error);
                    }
                });

                if (aiResponse) {
                    responseText = aiResponse;
                    await this.sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
                    Logger.info(`[Command] !ask berhasil untuk ${userId}.`);
                    success = true;
                } else {
                    errorMessage = 'Maaf, AI tidak dapat merespons saat ini.';
                    responseText = errorMessage;
                    // Pesan ini sudah ditangani oleh aiNexus jika showUserError: true
                    if (this.botConfig.get('userNotificationLevel') === 'verbose') {
                        // Tidak perlu kirim lagi jika sudah ditangani aiNexus
                    } else {
                         await this.sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
                    }
                    Logger.warn(`[Command] !ask gagal: ${errorMessage}`);
                    success = false;
                }
            } catch (error) {
                errorMessage = `Terjadi kesalahan internal AI: ${error.message}`;
                responseText = errorMessage;
                Logger.error(`[AskCommand] Error calling AI Nexus: ${error.message}`, error);
                await this.sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
                success = false;
            }
        }
        
        await this.aiNexus.getNavigator().processInteraction({
            prompt: `User executed !ask: "${prompt}"`,
            response: responseText,
            providerUsed: 'MetacognitiveNexus', // Menyebutkan komponen yang digunakan
            modelUsed: 'Orchestrated LLM', // Atau detail model LLM jika diambil dari aiResponse
            latencyMs: Date.now() - startTime,
            success: success,
            error: errorMessage ? new Error(errorMessage) : null,
            fallbackPath: [], // Ini akan diisi oleh aiNexus jika ada
            userId: userId, platform: platform,
            promptMetadata: { type: 'command_execution', command: this.name, originalPrompt: prompt }
        });
    }
}