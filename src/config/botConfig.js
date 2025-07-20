// File: genesis-core/src/config/botConfig.js
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Logger } from 'metacognitive-nexus'; 

const CONFIG_FILE = path.join(process.cwd(), 'data', 'bot_config.json');

class BotConfig {
    #config = {
        prefixMode: 'multi', 
        prefixes: ['!', '#', '/'],
        userNotificationLevel: 'verbose', 
        botJid: null, 
        schedulePollingIntervalMs: 60000,
        antiSpamGlobal: true, // Tambahkan ini: Mengaktifkan anti-spam secara global
    };

    constructor() {
        this.readyPromise = this.#loadConfig(); 
    }

    async #loadConfig() {
        try {
            await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
            const data = await fs.readFile(CONFIG_FILE, 'utf-8');
            const loadedConfig = JSON.parse(data);
            this.#config = { ...this.#config, ...loadedConfig };
            Logger.info('[BotConfig] Konfigurasi bot berhasil dimuat.');
        } catch (error) {
            if (error.code === 'ENOENT') {
                Logger.info('[BotConfig] File konfigurasi bot tidak ditemukan, memulai dengan konfigurasi default.');
                await this.saveConfig();
            } else {
                Logger.error('[BotConfig] Error saat memuat konfigurasi bot.', error);
            }
        }
    }

    async saveConfig() {
        try {
            await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
            await fs.writeFile(CONFIG_FILE, JSON.stringify(this.#config, null, 2), 'utf8');
            Logger.info('[BotConfig] Konfigurasi bot berhasil disimpan.');
        } catch (error) {
            Logger.error('[BotConfig] Gagal menyimpan konfigurasi bot.', error);
        }
    }

    get(key) {
        return this.#config[key];
    }

    async set(key, value) {
        if (this.#config.hasOwnProperty(key)) {
            this.#config[key] = value;
            await this.saveConfig();
            Logger.info(`[BotConfig] Konfigurasi '${key}' diatur ke '${value}'.`);
        } else {
            Logger.warn(`[BotConfig] Mencoba mengatur kunci konfigurasi tidak dikenal: '${key}'.`);
        }
    }

    async setBotJid(jid) {
        this.#config.botJid = jid;
        await this.saveConfig();
        Logger.info(`[BotConfig] Bot JID diatur ke: ${jid}.`);
    }
}

export const botConfig = new BotConfig();