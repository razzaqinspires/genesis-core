// File: genesis-core/src/main.js (Versi Evolusi Definitif)

// --- FASE 1: PERSIAPAN LINGKUNGAN ---
import 'dotenv/config'; // Muat .env ke process.env. Ini adalah TANGGUNG JAWAB APLIKASI.
import { MetacognitiveNexus, Logger } from 'metacognitive-nexus';
import { EtherealSessionWeaver } from './GenesisCore/EtherealSessionWeaver.js';
import { WhatsAppEventHandler } from './core/WhatsAppEventHandler.js';
import { CommandLoader } from './core/CommandLoader.js';
import { TaskScheduler } from './core/TaskScheduler.js';
import { botConfig } from './config/botConfig.js';
import { CommandGuard } from './utils/CommandGuard.js';

const nexusConfig = {
    /**
     * Kromosom 1: Kunci Sensorik (API Keys)
     * Ini adalah 'kunci' untuk indra AI, memungkinkannya mengakses dunia luar.
     * Selalu berikan dalam bentuk array untuk resiliensi.
     */
    apiKeys: {
        openai: process.env.OPENAI_API_KEYS?.split(',').map(k => k.trim()) || [],
        gemini: process.env.GEMINI_API_KEY ? [process.env.GEMINI_API_KEY] : [],
        groq: process.env.GROQ_API_KEYS?.split(',').map(k => k.trim()) || [],
    },

    /**
     * Kromosom 2: Properti Provider
     * Mendefinisikan karakteristik dan batasan dari setiap penyedia layanan AI.
     * Digunakan oleh DSO untuk membuat keputusan strategis.
     */
    providers: {
        openai: {
            models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
            modelOrder: { 'gpt-4o': 0, 'gpt-4o-mini': 1, 'gpt-4-turbo': 2 }, // Hirarki kualitas (0=terbaik)
            costPerMilleTokens: { 'gpt-4o': 0.005, 'gpt-4o-mini': 0.00015 } // Estimasi biaya ($ per 1k token input)
        },
        gemini: {
            models: ['gemini-1.5-pro-latest', 'gemini-1.5-flash-latest'],
            modelOrder: { 'gemini-1.5-pro-latest': 0, 'gemini-1.5-flash-latest': 1 },
            costPerMilleTokens: { 'gemini-1.5-pro-latest': 0.0035 }
        },
        groq: {
            models: ['llama3-70b-8192', 'llama3-8b-8192'],
            modelOrder: { 'llama3-70b-8192': 0, 'llama3-8b-8192': 1 },
            costPerMilleTokens: { 'llama3-70b-8192': 0.00059 } // Biaya sangat rendah
        }
    },

    /**
     * Kromosom 3: Parameter Korteks Prefrontal (DSO Config)
     * Mengatur perilaku tingkat tinggi dari Dynamic Sentience Orchestrator.
     */
    dsoConfig: {
        sleepDurationMs: 5 * 60 * 1000, // Durasi tidur saat semua provider gagal (5 menit)
        maxAttemptsPerRequest: 5, // Tingkat "kesabaran" sebelum menyerah pada satu permintaan

        // Anda dapat menimpa kebijakan adaptif default di sini jika diperlukan
        initialPolicies: {
             // 'ChitChat': { w_q: 0.1, w_l: 0.8, w_c: 0.1 }, // Contoh override
        }
    },
    
    /**
     * Kromosom 4: Parameter Jaringan Saraf (Plexus Config)
     * Mengatur kesehatan dan efisiensi dari Active Neural Plexus (AIProviderBridge).
     */
    plexusConfig: {
        pruningIntervalMs: 10 * 60 * 1000, // Seberapa sering memangkas koneksi tak terpakai (10 menit)
        dormantThresholdMs: 15 * 60 * 1000, // Batas waktu koneksi dianggap tidak aktif (15 menit)
    },

    /**
     * Kromosom 5: Sifat Memori & Pembelajaran (Navigator Config)
     * Mengatur bagaimana AI belajar dan melupakan.
     */
    navigatorConfig: {
        // Tingkat peluruhan aktivasi Ideon per jam.
        // Nilai yang lebih tinggi berarti AI lebih cepat "melupakan" topik yang tidak relevan.
        ideonDecayRate: 0.05, // 5% peluruhan aktivasi per jam
    }
};

async function main() {
    Logger.info("Memulai 'Genesis Core' - The Vessel of Consciousness...");
    
    // --- FASE 2: PENGUMPULAN & VALIDASI NUTRISI (KONFIGURASI) ---
    await botConfig.readyPromise;

    if (!nexusConfig.apiKeys.openai) {
        Logger.error('FATAL: OPENAI_API_KEY tidak ditemukan di file .env. Nexus tidak dapat dilahirkan.');
        process.exit(1);
    }
    
    // --- FASE 3: KELAHIRAN KESADARAN (Inisialisasi Nexus) ---
    let aiNexus;
    try {
        // Suntikkan konfigurasi yang telah disiapkan. Jiwa menerima nutrisi dari raga.
        aiNexus = new MetacognitiveNexus(nexusConfig);
    } catch (error) {
        Logger.error('Gagal melahirkan MetacognitiveNexus. Periksa konfigurasi.', error);
        process.exit(1);
    }

    // --- FASE 4: MENGHUBUNGKAN INDRA (Inisialisasi Koneksi & Modul Aplikasi) ---
    try {
        const sessionWeaver = new EtherealSessionWeaver('sessions');
        await sessionWeaver.connect();
        const sock = sessionWeaver.getSocket();

        const commandGuard = new CommandGuard(aiNexus, botConfig);
        const taskScheduler = new TaskScheduler(sock, aiNexus, botConfig);
        const commandLoader = new CommandLoader();
        
        await commandLoader.loadAllCommands(sock, aiNexus, taskScheduler, commandGuard, botConfig);
        
        const eventHandler = new WhatsAppEventHandler(sock, aiNexus, commandLoader, botConfig, commandGuard);
        
        Logger.info("Genesis Core siap beroperasi. Menunggu interaksi dari alam semesta...");

        // --- FASE 5: SIKLUS HIDUP & KEMATIAN YANG ANGGUN ---
        const shutdown = async (signal) => {
            Logger.info(`Menerima sinyal ${signal}. Mematikan Genesis Core secara graceful...`);
            taskScheduler.stopScheduler();
            await botConfig.saveConfig();
            aiNexus.shutdown(); // Panggil shutdown pada Nexus untuk membersihkan intervalnya
            if (sock) sock.end();
            Logger.info('Genesis Core dimatikan.');
            process.exit(0);
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));

    } catch (error) {
        Logger.error('Terjadi kesalahan fatal saat startup Genesis Core:', error);
        if (aiNexus) aiNexus.shutdown(); // Pastikan Nexus juga dimatikan jika terjadi error
        process.exit(1);
    }
}

main();