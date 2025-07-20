// File: genesis-core/src/GenesisCore/EtherealSessionWeaver.js (Lengkap & Diperbaiki)

import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { Logger } from 'metacognitive-nexus';
import readline from 'node:readline';
import qrcode from 'qrcode-terminal';
import fs from 'node:fs/promises';
import path from 'node:path';

export class EtherealSessionWeaver {
    #sock = null;
    #sessionPath;
    #status = 'IDLE';
    #heartbeatInterval = null;

    constructor(sessionDir = 'sessions') {
        this.#sessionPath = path.resolve(process.cwd(), sessionDir);
    }

    async #ensureSessionDirectory() {
        try {
            await fs.mkdir(this.#sessionPath, { recursive: true });
        } catch (error) {
            Logger.error(`[SessionWeaver] Kritis: Gagal membuat direktori sesi.`, error);
            throw error;
        }
    }

    async #initiateEntanglement(sock) {
        this.#status = 'AWAITING_ENTANGLEMENT';
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const question = (query) => new Promise(resolve => rl.question(query, resolve));

        try {
            const answer = await question('⚠️  Sesi tidak ditemukan. Pilih metode login (QR / PAIRING): ');
            const usePairingCode = answer.toLowerCase().startsWith('p');

            if (usePairingCode) {
                Logger.info("Memulai dengan Kode Pairing...");
                const phoneNumber = await question('Masukkan nomor telepon Anda (cth: 628123...): ');
                if (sock) {
                    setTimeout(async () => {
                        try {
                            const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
                            Logger.info(`✅ KODE PAIRING ANDA: ${code}`);
                        } catch (e) { Logger.error("Gagal meminta pairing code.", e); }
                    }, 1000);
                }
            } else {
                Logger.info("Memulai dengan QR Code. Silakan tunggu...");
            }
        } finally {
            rl.close();
        }
    }

    async connect() {
        if (this.#status === 'STABLE' || this.#status === 'CONNECTING') return;

        this.#status = 'CONNECTING';
        Logger.info('[SessionWeaver] Memulai sekuens koneksi...');
        await this.#ensureSessionDirectory();

        const { state, saveCreds } = await useMultiFileAuthState(this.#sessionPath);
        
        this.#sock = makeWASocket({
            logger: Logger.getPinoInstance({ level: 'silent' }),
            printQRInTerminal: false,
            browser: Browsers.macOS('Chrome'),
            auth: state,
        });

        this.#registerEventListeners();

        if (!state.creds.me) {
            await this.#initiateEntanglement(this.#sock);
        }

        return new Promise((resolve, reject) => {
            const handler = (update) => {
                const { connection, lastDisconnect } = update;
                if (connection === 'open') {
                    this.#sock?.ev.removeListener('connection.update', handler);
                    resolve();
                } else if (connection === 'close' && this.#status !== 'RECONNECTING') {
                    this.#sock?.ev.removeListener('connection.update', handler);
                    reject(lastDisconnect?.error || new Error('Koneksi ditutup sebelum stabil.'));
                }
            };
            this.#sock.ev.on('connection.update', handler);
        });
    }
    
    #registerEventListeners() {
        this.#sock.ev.on('creds.update', this.#authState.saveCreds);
        this.#sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr && this.#status === 'AWAITING_ENTANGLEMENT') {
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                this.#stopHeartbeat();
                this.#status = 'DISCONNECTED';
                const boomError = lastDisconnect?.error instanceof Boom ? lastDisconnect.error : null;
                const shouldReconnect = boomError?.output?.statusCode !== DisconnectReason.loggedOut;
                
                Logger.error(`[SessionWeaver] Koneksi terputus: "${boomError?.message || 'Tidak diketahui'}". Menyambung ulang: ${shouldReconnect}`);

                if (shouldReconnect) {
                    this.#status = 'RECONNECTING';
                    setTimeout(() => this.connect().catch(err => {
                        Logger.error('[SessionWeaver] Gagal total saat menyambung ulang.', err);
                        process.exit(1);
                    }), 5000);
                } else {
                    Logger.error('[SessionWeaver] Logout permanen. Hapus folder sesi dan mulai ulang.');
                    process.exit(1);
                }
            } else if (connection === 'open') {
                this.#status = 'STABLE';
                const userName = this.#sock.user?.name || this.#sock.user?.id;
                Logger.info(`✅ Entanglement kuantum stabil. Terhubung sebagai: ${userName}`);
                this.#startHeartbeat();
            }
        });
    }

    #startHeartbeat() {
        this.#stopHeartbeat();
        this.#heartbeatInterval = setInterval(() => {
            if (this.#status === 'STABLE') {
                this.#sock.sendPresenceUpdate('available');
                Logger.debug('[Heartbeat] ❤️ Sinyal kehadiran dikirim.');
            }
        }, 60 * 1000);
    }
    
    #stopHeartbeat() {
        clearInterval(this.#heartbeatInterval);
        this.#heartbeatInterval = null;
    }

    getSocket() {
        if (this.#status !== 'STABLE' || !this.#sock) {
            throw new Error(`Permintaan socket gagal. Koneksi belum stabil. Status: ${this.#status}.`);
        }
        return this.#sock;
    }
    
    shutdown() {
        this.#stopHeartbeat();
        Logger.info('[SessionWeaver] Detak jantung koneksi dihentikan.');
    }
}