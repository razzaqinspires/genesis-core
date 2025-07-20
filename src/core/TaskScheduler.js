// File: genesis-core/src/core/TaskScheduler.js
import { Logger } from 'metacognitive-nexus'; // Menggunakan Logger dari metacognitive-nexus
import { botConfig } from '../config/botConfig.js'; // Import instance BotConfig
import { promises as fs } from 'node:fs';
import path from 'node:path';

const SCHEDULE_FILE = path.join(process.cwd(), 'data', 'scheduled_tasks.json');

export class TaskScheduler {
    #scheduledTasks = [];
    #taskHandlers = new Map();
    #intervalId = null;
    #sock;
    #aiNexus;
    #tasksDir;
    #botConfig;

    constructor(sock, aiNexus, botConfigInstance, tasksDir = 'src/tasks') {
        this.#sock = sock;
        this.#aiNexus = aiNexus;
        this.#botConfig = botConfigInstance;
        this.#tasksDir = path.resolve(process.cwd(), tasksDir);
        this.#loadTasks().catch(err => Logger.error('[TaskScheduler] Gagal memuat tasks.', err));
        this.#loadScheduledTasks().catch(err => Logger.error('[TaskScheduler] Gagal memuat jadwal tugas.', err));
    }

    async #loadTasks() {
        try {
            await fs.mkdir(this.#tasksDir, { recursive: true });
            const files = await fs.readdir(this.#tasksDir);
            for (const file of files) {
                if (file.endsWith('.js')) {
                    const taskName = file.replace('.js', '');
                    const modulePath = path.join(this.#tasksDir, file);
                    try {
                        const { default: TaskClass } = await import(`file://${modulePath}?update=${Date.now()}`);
                        if (typeof TaskClass === 'function' && TaskClass.prototype.execute) {
                            const taskInstance = new TaskClass(this.#sock, this.#aiNexus);
                            this.#taskHandlers.set(taskName.toLowerCase(), taskInstance);
                            Logger.info(`[TaskScheduler] Task '${taskName}' dimuat.`);
                        } else {
                            Logger.warn(`[TaskScheduler] File ${file} bukan kelas task yang valid.`);
                        }
                    } catch (e) {
                        Logger.error(`[TaskScheduler] Gagal memuat task '${file}': ${e.message}`, e);
                    }
                }
            }
            Logger.info(`[TaskScheduler] Berhasil memuat ${this.#taskHandlers.size} task handler.`);
        } catch (error) {
            Logger.error(`[TaskScheduler] Gagal membaca direktori task: ${error.message}`, error);
        }
    }

    async #loadScheduledTasks() {
        try {
            await fs.mkdir(path.dirname(SCHEDULE_FILE), { recursive: true });
            const data = await fs.readFile(SCHEDULE_FILE, 'utf-8');
            this.#scheduledTasks = JSON.parse(data);
            Logger.info(`[TaskScheduler] Berhasil memuat ${this.#scheduledTasks.length} jadwal tugas.`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                Logger.info('[TaskScheduler] File jadwal tugas tidak ditemukan, memulai dengan jadwal kosong.');
                this.#scheduledTasks = [];
            } else {
                Logger.error('[TaskScheduler] Error saat memuat jadwal tugas.', error);
            }
        }
    }

    async #saveScheduledTasks() {
        try {
            await fs.writeFile(SCHEDULE_FILE, JSON.stringify(this.#scheduledTasks, null, 2), 'utf-8');
            Logger.debug('[TaskScheduler] Jadwal tugas disimpan.');
        } catch (error) {
            Logger.error('[TaskScheduler] Gagal menyimpan jadwal tugas.', error);
        }
    }

    async scheduleTask(taskName, cronExpression, metadata = {}) {
        if (!this.#taskHandlers.has(taskName.toLowerCase())) {
            Logger.error(`[TaskScheduler] Task handler '${taskName}' tidak ditemukan.`);
            return false;
        }
        const newTask = {
            id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            name: taskName,
            cron: cronExpression, // Ini harus di-parse dengan pustaka cron yang sebenarnya
            metadata: metadata,
            lastRun: null,
            nextRun: this.#calculateNextRun(cronExpression),
            enabled: true,
        };
        this.#scheduledTasks.push(newTask);
        await this.#saveScheduledTasks();
        Logger.info(`[TaskScheduler] Tugas '${taskName}' dijadwalkan untuk: ${cronExpression}.`);
        return true;
    }

    async cancelTask(id) {
        const initialLength = this.#scheduledTasks.length;
        this.#scheduledTasks = this.#scheduledTasks.filter(task => task.id !== id);
        if (this.#scheduledTasks.length < initialLength) {
            await this.#saveScheduledTasks();
            Logger.info(`[TaskScheduler] Tugas dengan ID '${id}' dibatalkan.`);
            return true;
        }
        Logger.warn(`[TaskScheduler] Tugas dengan ID '${id}' tidak ditemukan.`);
        return false;
    }

    #calculateNextRun(cronExpression) {
        // Placeholder untuk perhitungan cron yang sebenarnya.
        // Di produksi, gunakan pustaka seperti 'node-cron' atau 'cron-parser'.
        // Contoh sederhana untuk demo: setiap 1 menit dari sekarang
        return new Date(Date.now() + this.#botConfig.get('schedulePollingIntervalMs'));
    }

    async #runDueTasks() {
        const now = Date.now();
        for (const task of this.#scheduledTasks) {
            if (task.enabled && task.nextRun && new Date(task.nextRun).getTime() <= now) {
                Logger.info(`[TaskScheduler] Menjalankan tugas terjadwal: ${task.name} (${task.id})`);
                const handler = this.#taskHandlers.get(task.name.toLowerCase());
                if (handler) {
                    try {
                        await handler.execute(task.metadata);
                        task.lastRun = new Date();
                        task.nextRun = this.#calculateNextRun(task.cron);
                        await this.#saveScheduledTasks();
                    } catch (error) {
                        Logger.error(`[TaskScheduler] Error saat menjalankan tugas '${task.name}': ${error.message}`, error);
                    }
                } else {
                    Logger.warn(`[TaskScheduler] Handler untuk tugas '${task.name}' tidak ditemukan.`);
                }
            }
        }
    }

    startScheduler() {
        if (this.#intervalId) {
            Logger.warn('[TaskScheduler] Scheduler sudah berjalan.');
            return;
        }
        this.#intervalId = setInterval(() => this.#runDueTasks(), this.#botConfig.get('schedulePollingIntervalMs'));
        Logger.info('[TaskScheduler] Scheduler dimulai.');
    }

    stopScheduler() {
        if (this.#intervalId) {
            clearInterval(this.#intervalId);
            this.#intervalId = null;
            Logger.info('[TaskScheduler] Scheduler dihentikan.');
        }
    }
}