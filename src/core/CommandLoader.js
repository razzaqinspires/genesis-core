// File: genesis-core/src/core/CommandLoader.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { Logger } from 'metacognitive-nexus';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class CommandLoader {
    #commandsDir;
    #commands = new Map(); // Map: commandName -> CommandInstance

    constructor(commandsDir = 'src/commands') {
        this.#commandsDir = path.resolve(__dirname, '..', '..', commandsDir);
        Logger.info(`[CommandLoader] Memuat perintah dari: ${this.#commandsDir}`);
    }

    async loadAllCommands(sock, aiNexus, taskScheduler, commandGuard) { // Menerima CommandGuard
        try {
            await fs.mkdir(this.#commandsDir, { recursive: true }); // Pastikan direktori root commands ada
            const categories = await fs.readdir(this.#commandsDir, { withFileTypes: true });

            for (const categoryDirent of categories) {
                if (categoryDirent.isDirectory()) {
                    const categoryPath = path.join(this.#commandsDir, categoryDirent.name);
                    const files = await fs.readdir(categoryPath);

                    for (const file of files) {
                        if (file.endsWith('.js')) {
                            const commandName = file.replace('.js', '');
                            const modulePath = path.join(categoryPath, file);
                            try {
                                const { default: CommandClass } = await import(`file://${modulePath}?update=${Date.now()}`);
                                if (typeof CommandClass === 'function' && CommandClass.prototype.execute) {
                                    // Meneruskan semua dependensi ke konstruktor perintah
                                    const commandInstance = new CommandClass(sock, aiNexus, taskScheduler, commandGuard); 
                                    this.#commands.set(commandName.toLowerCase(), commandInstance);
                                    Logger.info(`[CommandLoader] Perintah '${commandName}' dari kategori '${categoryDirent.name}' dimuat.`);
                                } else {
                                    Logger.warn(`[CommandLoader] File ${file} di ${categoryDirent.name} bukan kelas perintah yang valid.`);
                                }
                            } catch (e) {
                                Logger.error(`[CommandLoader] Gagal memuat perintah '${file}' dari kategori '${categoryDirent.name}': ${e.message}`, e);
                            }
                        }
                    }
                }
            }
            Logger.info(`[CommandLoader] Berhasil memuat ${this.#commands.size} perintah dari semua kategori.`);
        } catch (error) {
            Logger.error(`[CommandLoader] Gagal membaca direktori perintah atau kategori: ${error.message}`, error);
        }
    }

    getCommand(commandName) {
        return this.#commands.get(commandName.toLowerCase());
    }

    getAllCommandNames() {
        return Array.from(this.#commands.keys());
    }
}