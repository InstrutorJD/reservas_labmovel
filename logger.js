const LOG_STORAGE_KEY = 'reservas_labmovel_logs';
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let currentVerbosity = LEVELS.debug;
let appName = 'reservas_labmovel';
let persisted = true;
let entries = [];

function formatTimestamp(date = new Date()) {
    return date.toISOString();
}

function canPersist() {
    try {
        return typeof localStorage !== 'undefined';
    } catch {
        return false;
    }
}

function saveEntries() {
    if (!persisted || !canPersist()) return;
    try {
        localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(entries));
    } catch {
        // Silenciar falha de persistência em ambientes restritos
    }
}

function createEntry(level, tag, message, data) {
    const payload = {
        timestamp: formatTimestamp(),
        level,
        app: appName,
        tag: tag || 'app',
        message: message || '',
        data: data === undefined ? null : data
    };
    entries.push(payload);
    saveEntries();
    return payload;
}

function writeLog(level, tag, message, data) {
    const entry = createEntry(level, tag, message, data);
    if (typeof console !== 'undefined') {
        const consoleMethod = console[level] ? level : 'log';
        console[consoleMethod](`[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.tag}] ${entry.message}`, entry.data);
    }
    return entry;
}

export function initLogger(options = {}) {
    appName = options.appName || appName;
    persisted = options.persist !== undefined ? options.persist : persisted;
    currentVerbosity = LEVELS[options.level] || currentVerbosity;
    entries = [];
    if (persisted && canPersist()) {
        const stored = localStorage.getItem(LOG_STORAGE_KEY);
        if (stored) {
            try {
                entries = JSON.parse(stored) || [];
            } catch {
                entries = [];
            }
        }
    }
    writeLog('info', 'logger', 'Logger inicializado', { appName, persisted, level: currentVerbosity });
}

export function setLogLevel(level) {
    if (LEVELS[level]) {
        currentVerbosity = LEVELS[level];
        writeLog('info', 'logger', 'Nível de log atualizado', { level });
        return true;
    }
    writeLog('warn', 'logger', 'Tentativa de usar nível de log inválido', { level });
    return false;
}

export function getLogs() {
    return entries.slice();
}

export function clearLogs() {
    entries = [];
    if (canPersist()) {
        try {
            localStorage.removeItem(LOG_STORAGE_KEY);
        } catch {
            // ignore
        }
    }
    writeLog('info', 'logger', 'Logs limpos');
}

export function downloadLogs(filename = 'reservas_labmovel.log') {
    const content = getLogs().map((entry) => `${entry.timestamp} [${entry.level.toUpperCase()}] [${entry.tag}] ${entry.message} ${entry.data ? JSON.stringify(entry.data) : ''}`).join('\n');
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof document === 'undefined') {
        writeLog('warn', 'logger', 'Download de logs não suportado neste ambiente.');
        return null;
    }
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    writeLog('info', 'logger', 'Logs exportados', { filename, entries: entries.length });
    return filename;
}

function logIfAllowed(level, tag, message, data) {
    if (LEVELS[level] >= currentVerbosity) {
        return writeLog(level, tag, message, data);
    }
    return null;
}

export const logger = {
    init: initLogger,
    setLevel: setLogLevel,
    getLogs,
    clear: clearLogs,
    download: downloadLogs,
    debug: (tag, message, data) => logIfAllowed('debug', tag, message, data),
    info: (tag, message, data) => logIfAllowed('info', tag, message, data),
    warn: (tag, message, data) => logIfAllowed('warn', tag, message, data),
    error: (tag, message, data) => logIfAllowed('error', tag, message, data),
    event: (tag, message, data) => logIfAllowed('info', tag, message, data)
};
