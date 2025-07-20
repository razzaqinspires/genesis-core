// File: genesis-core/src/main.js
import { EtherealSessionWeaver } from './GenesisCore/EtherealSessionWeaver.js';
import { WhatsAppEventHandler } from './core/WhatsAppEventHandler.js';
import { CommandLoader } from './core/CommandLoader.js';
import { TaskScheduler } from './core/TaskScheduler.js';
import { botConfig } from './config/botConfig.js';
import { CommandGuard } from './utils/CommandGuard.js';
import { MetacognitiveNexus } from 'metacognitive-nexus';

// Memuat environment variables dari .env file. Ini harus dipanggil SETIDAKNYA sekali di awal aplikasi.
import 'dotenv/config'; 

// Menggunakan Logger dari metacognitive-nexus untuk konsistensi di seluruh aplikasi.
import { Logger } from 'metacognitive-nexus';

async function main() {
    Logger.info("Memulai 'Genesis Core - Quantum Command & Adaptive Runtime'...");

    // Pastikan konfigurasi bot (botConfig) dimuat sepenuhnya sebelum komponen lain menggunakannya.
    await botConfig.readyPromise; 
    
    // Inisialisasi EtherealSessionWeaver, meneruskan Logger dari metacognitive-nexus.
    const sessionWeaver = new EtherealSessionWeaver('sessions', Logger); 
    
    // Inisialisasi MetacognitiveNexus, yang akan mengelola LLM eksternal, memori, dan pembelajaran AI.
    const aiNexus = new MetacognitiveNexus();

    try {
        // Sambungkan bot ke WhatsApp melalui EtherealSessionWeaver.
        await sessionWeaver.connect();
        const sock = sessionWeaver.getSocket(); // Dapatkan instance socket Baileys setelah terhubung.
        Logger.info("Genesis Core: Koneksi WhatsApp stabil.");

        // Inisialisasi CommandGuard lebih awal karena diperlukan oleh CommandLoader dan WhatsAppEventHandler.
        // CommandGuard membutuhkan aiNexus dan botConfig untuk fungsionalitas cerdasnya.
        const commandGuard = new CommandGuard(aiNexus, botConfig);

        // Inisialisasi TaskScheduler, yang akan menjalankan tugas latar belakang secara persisten.
        const taskScheduler = new TaskScheduler(sock, aiNexus, botConfig);
        taskScheduler.startScheduler(); // Mulai scheduler untuk menjalankan tugas terjadwal.
        Logger.info("Genesis Core: Task Scheduler aktif.");

        // Inisialisasi CommandLoader, yang bertanggung jawab memuat semua perintah dinamis dari file.
        // Meneruskan semua dependensi inti ke konstruktor perintah.
        const commandLoader = new CommandLoader();
        await commandLoader.loadAllCommands(sock, aiNexus, taskScheduler, commandGuard, botConfig); 

        // Inisialisasi WhatsAppEventHandler, yang menangani semua event pesan masuk dan logika respons.
        // Meneruskan semua dependensi inti.
        const eventHandler = new WhatsAppEventHandler(sock, aiNexus, commandLoader, botConfig, commandGuard);
        Logger.info("Genesis Core: WhatsApp Event Handler aktif.");

        // Menjaga proses Node.js tetap hidup secara eksplisit.
        process.stdin.resume();

        // Mengimplementasikan graceful shutdown untuk memastikan data tersimpan dan koneksi ditutup dengan benar.
        process.on('SIGINT', async () => {
            Logger.info('Sinyal SIGINT (Ctrl+C) diterima. Mematikan Genesis Core secara graceful...');
            taskScheduler.stopScheduler(); // Hentikan semua tugas terjadwal.
            await botConfig.saveConfig(); // Simpan konfigurasi bot yang terbaru.
            sock.end(); // Akhiri koneksi Baileys dengan rapi.
            Logger.info('Genesis Core dimatikan.');
            process.exit(0); // Keluar dari proses dengan kode sukses.
        });

    } catch (error) {
        Logger.error('Terjadi kesalahan fatal saat startup Genesis Core:', error);
        process.exit(1); // Keluar dari proses dengan kode error.
    }
}

// Jalankan fungsi main untuk memulai aplikasi bot.
main();