// File: genesis-core/src/GenesisCore/EtherealSessionWeaver.js
import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { Logger } from 'metacognitive-nexus';
import readline from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';

export class EtherealSessionWeaver {
    #sock = null;
    #sessionPath;
    #logger;
    #authState = null;
    #rl = null;

    constructor(sessionDir = 'sessions') {
        this.#sessionPath = path.resolve(process.cwd(), sessionDir);
        this.#logger = Logger({ level: 'silent' });
    }

    async #ensureSessionDirectory() {
        try {
            await fs.mkdir(this.#sessionPath, { recursive: true });
            this.#logger.info(`Memastikan direktori sesi '${this.#sessionPath}' tersedia.`);
        } catch (error) {
            this.#logger.error(`Gagal membuat direktori sesi: ${error.message}`);
            throw new Error(`Failed to create session directory: ${error.message}`);
        }
    }

    async #promptAuthMethod() {
        this.#rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise(resolve => {
            this.#rl?.question('Pilih metode autentikasi (qr/pairing): ', (answer) => {
                this.#rl?.close();
                if (answer.toLowerCase() === 'qr') {
                    resolve('qr');
                } else if (answer.toLowerCase() === 'pairing') {
                    resolve('pairing');
                } else {
                    this.#logger.warn('Pilihan tidak valid. Menggunakan QR Code sebagai default.');
                    resolve('qr');
                }
            });
        });
    }

    async connect() {
        await this.#ensureSessionDirectory();

        const { state, saveCreds } = await useMultiFileAuthState(this.#sessionPath);
        this.#authState = { state, saveCreds };

        this.#sock = makeWASocket({
            logger: this.#logger,
            printQRInTerminal: false,
            browser: Browsers.macOS('Chrome'),
            auth: state,
            getMessage: async (key) => {
                return undefined;
            }
        });

        this.#sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr, isNewLogin, pairingCode } = update;

            if (qr) {
                if (!this.#authState?.state.creds.registered) {
                    console.log('Silakan pindai QR Code ini:', qr);
                }
            }

            if (pairingCode) {
                console.log(`Kode Pairing Anda: ${pairingCode}`);
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                this.#logger.info(`Koneksi ditutup karena ${lastDisconnect?.error?.message}, menyambung ulang: ${shouldReconnect}`);

                if (shouldReconnect) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    await this.connect();
                } else {
                    this.#logger.error('Koneksi terputus secara permanen. Silakan hapus sesi dan coba lagi.');
                    process.exit(1);
                }
            } else if (connection === 'open') {
                this.#logger.info('Koneksi WhatsApp terbuka dan stabil. Genesis Core siap beroperasi.');
            }

            if (!this.#authState?.state.creds.registered && !isNewLogin && connection === 'connecting') {
                const sessionFilesExist = await fs.readdir(this.#sessionPath).then(files => files.length > 0).catch(() => false);
                if (!sessionFilesExist) {
                    const authMethod = await this.#promptAuthMethod();
                    if (authMethod === 'pairing') {
                         this.#logger.info("Menunggu kode pairing... Pastikan Anda memilih opsi 'Hubungkan Perangkat dengan Nomor Telepon' di aplikasi WhatsApp Anda.");
                    } else {
                        this.#logger.info("Menunggu QR Code...");
                    }
                }
            }
        });

        this.#sock.ev.on('creds.update', saveCreds);

        return new Promise((resolve) => {
            this.#sock?.ev.on('connection.update', ({ connection }) => {
                if (connection === 'open') {
                    resolve();
                }
            });
        });
    }

    getSocket() {
        if (!this.#sock) {
            throw new Error('Socket WhatsApp belum terinisialisasi. Panggil connect() terlebih dahulu.');
        }
        return this.#sock;
    }
}