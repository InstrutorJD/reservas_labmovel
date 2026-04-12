import { logger } from './logger.js';

// ============================================================
// Constantes
// ============================================================
export const TOTAL_CHROMEBOOKS = 19;
export const PIN_STORAGE_KEY = 'reservasLabMovelPin';

export const SUPABASE_URL = 'https://gtcnfduwuvviwnkhzvtz.supabase.co';
export const SUPABASE_API_KEY = 'sb_publishable_znokxuPIG-HU_uue3mJzKA_mweoqiT-';
export const SUPABASE_BATCH_TABLE = 'reservation_batches';
export const SUPABASE_ITEM_TABLE = 'reservation_items';

export const PERIODOS = [
    { value: '1', label: '1º (07:00-07:50)' },
    { value: '2', label: '2º (07:50-08:40)' },
    { value: '3', label: '3º (09:00-09:50)' },
    { value: '4', label: '4º (09:50-10:40)' },
    { value: '5', label: '5º (10:40-11:30)' },
    { value: '6', label: '6º (12:20-13:10)' },
    { value: '7', label: '7º (13:10-14:00)' }
];

// ============================================================
// Estado global — DECLARADO NO TOPO para evitar ReferenceError
// (BUG CORRIGIDO: antes estava declarado após funções que o usavam)
// ============================================================
const state = {
    reservas: [],
    batches: [],
    selectedChromebooks: [],
    selectedHours: [],
    dataAtiva: getDataLocal(),
    userPin: getStoredUserPin(),
    deviceIp: null,
    pendingCancellationReservation: null
};

let alertTimeoutId = null;
const ALERT_HIDE_DELAY = 4500;

// ============================================================
// Utilitários de data e hora
// ============================================================
export function getAgora({ useMock = false, hour, minute } = {}) {
    if (useMock) {
        if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
            throw new Error('Hora e minuto devem ser informados quando useMock é true.');
        }
        const now = new Date();
        now.setHours(hour, minute, 0, 0);
        return now;
    }
    return new Date();
}

export function getDataLocal() {
    return new Date().toLocaleDateString('en-CA');
}

// ============================================================
// PIN do usuário (localStorage)
// ============================================================
export function getStoredUserPin() {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(PIN_STORAGE_KEY);
}

export function storeUserPin(pin) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(PIN_STORAGE_KEY, pin);
}

export function generatePin() {
    return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

// BUG CORRIGIDO: state já está declarado antes desta função
export function getOrCreateUserPin() {
    if (state.userPin) return state.userPin;
    const storedPin = getStoredUserPin();
    if (storedPin && /^\d{4}$/.test(storedPin)) {
        state.userPin = storedPin;
        return storedPin;
    }
    const newPin = generatePin();
    state.userPin = newPin;
    storeUserPin(newPin);
    return newPin;
}

// ============================================================
// IP do dispositivo
// ============================================================
export async function getDeviceIp() {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return null;
    try {
        const response = await window.fetch('https://api.ipify.org?format=json');
        if (!response.ok) return null;
        const data = await response.json();
        return typeof data.ip === 'string' ? data.ip : null;
    } catch {
        return null;
    }
}

// BUG CORRIGIDO: state já está declarado antes desta função
export async function ensureDeviceIp() {
    if (state.deviceIp) return state.deviceIp;
    const ip = await getDeviceIp();
    state.deviceIp = ip;
    return ip;
}

// ============================================================
// Mapeamento de períodos e horários
// ============================================================
export function getPeriodoFromTime(hour, minute) {
    const minutes = hour * 60 + minute;
    if (minutes >= 420 && minutes < 470) return '1';
    if (minutes >= 470 && minutes < 540) return '2';
    if (minutes >= 540 && minutes < 590) return '3';
    if (minutes >= 590 && minutes < 640) return '4';
    if (minutes >= 640 && minutes < 690) return '5';
    if (minutes >= 740 && minutes < 790) return '6';
    if (minutes >= 790 && minutes < 840) return '7';
    // Intervalo 690-739 (11:30-12:20) → almoço, sem período ativo
    return null;
}

export function getPeriodoHorario(periodo) {
    switch (periodo) {
        case '1': return '07:50';
        case '2': return '08:40';
        case '3': return '09:50';
        case '4': return '10:40';
        case '5': return '11:30';
        case '6': return '13:10';
        case '7': return '14:00';
        default:  return '';
    }
}

// ============================================================
// Verificação de período expirado
// Retorna true se o período já passou no dia de hoje.
// Para datas futuras retorna sempre false.
// ============================================================
export function isPeriodoExpirado(data, periodo) {
    const hoje = getDataLocal();
    if (data !== hoje) return false; // data futura → nunca expirado
    // Bloqueio pelo horário de TÉRMINO — professor ainda pode reservar durante o período
    const terminos = { '1': [7,50], '2': [8,40], '3': [9,50], '4': [10,40], '5': [11,30], '6': [13,10], '7': [14,0] };
    const termino = terminos[String(periodo)];
    if (!termino) return false;
    const agora = new Date();
    const minutosAgora   = agora.getHours() * 60 + agora.getMinutes();
    const minutosTermino = termino[0] * 60 + termino[1];
    return minutosAgora >= minutosTermino;
}

// ============================================================
// Helpers de reserva (lógica local)
// ============================================================
export function getReservaParaItem(reservas, chromebookId, data, periodo) {
    const periodoStr = String(periodo);
    const chromebookNum = Number(chromebookId);
    return reservas.find((r) =>
        r.data === data &&
        String(r.periodo) === periodoStr &&
        // BUG CORRIGIDO: normalizar ambos para Number antes de comparar
        Number(r.chromebook_id) === chromebookNum
    );
}

// BUG CORRIGIDO: generateFutureBusinessDates agora pula o dia atual
// quando todos os períodos já passaram (após 14h)
export function generateFutureBusinessDates(startDate = new Date(), count = 7) {
    const dates = [];
    const cursor = new Date(startDate);
    cursor.setHours(0, 0, 0, 0);
    const now = new Date();
    if (now.getHours() >= 14) {
        cursor.setDate(cursor.getDate() + 1);
    }
    while (dates.length < count) {
        if (cursor.getDay() !== 0 && cursor.getDay() !== 6) {
            dates.push(new Date(cursor));
        }
        cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
}

export function getOcupadosParaDataPeriodo(reservas, data, periodo) {
    const periodoStr = String(periodo);
    return [...new Set(
        reservas
            .filter((r) => r.data === data && String(r.periodo) === periodoStr)
            // BUG CORRIGIDO: normalizar chromebook_id para Number
            .map((r) => Number(r.chromebook_id))
    )];
}

export function getOcupadosParaPeriodos(reservas, data, periodos = []) {
    const ocupados = new Set();
    if (!Array.isArray(periodos)) return [];
    periodos.forEach((periodo) => {
        getOcupadosParaDataPeriodo(reservas, data, periodo).forEach((id) => ocupados.add(id));
    });
    return [...ocupados];
}

export function isChromebookOcupado(reservas, chromebookId, data, periodo) {
    return getOcupadosParaDataPeriodo(reservas, data, periodo).includes(Number(chromebookId));
}

export function generateBatchId() {
    return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildReservationBatch(nome, data, periodos, pin, ip) {
    const timestamp = new Date().toISOString();
    return {
        id: generateBatchId(),
        professor: nome,
        date: data,
        periods: periodos.map(String),
        pin,
        device_ip: ip || null,
        created_at: timestamp,
        updated_at: timestamp
    };
}

export function buildReservationItem(batchId, nome, data, periodo, chromebookId, pin, ip) {
    // BUG CORRIGIDO: usar crypto.randomUUID() para evitar colisão em loops rápidos
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `item_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    return {
        id,
        batch_id: batchId,
        professor: nome,
        chromebook_id: Number(chromebookId),
        data,
        periodo,
        pin,
        ip: ip || null,
        status: 'active',
        created_at: new Date().toISOString()
    };
}

export function buildReservationObject(nome, data, periodo, chromebookId, pin, ip, batchId) {
    const reservation = {
        professor: nome,
        chromebook_id: Number(chromebookId),
        data,
        periodo
    };
    if (typeof batchId !== 'undefined') reservation.batch_id = batchId;
    if (typeof pin !== 'undefined')     reservation.pin = pin;
    if (typeof ip !== 'undefined')      reservation.ip = ip;
    return reservation;
}

export function validateReservaInput(nome, data, periodos, chromebookIds) {
    if (!nome || nome.trim().length === 0) {
        return { valid: false, message: 'Informe o nome do professor.' };
    }
    if (!data) {
        return { valid: false, message: 'Informe a data da reserva.' };
    }
    if (!Array.isArray(periodos) || periodos.length === 0) {
        return { valid: false, message: 'Selecione ao menos um período.' };
    }
    // Bloquear períodos já expirados no dia atual (defesa no servidor lógico)
    const periodosExpirados = periodos.filter((p) => isPeriodoExpirado(data, p));
    if (periodosExpirados.length > 0) {
        return { valid: false, message: 'Um ou mais períodos selecionados já passaram e não podem ser reservados.' };
    }
    if (!Array.isArray(chromebookIds) || chromebookIds.length === 0) {
        return { valid: false, message: 'Selecione ao menos um Chromebook.' };
    }
    const allIdsValid = chromebookIds.every((id) => {
        const numericId = Number(id);
        return Number.isInteger(numericId) && numericId >= 1 && numericId <= TOTAL_CHROMEBOOKS;
    });
    if (!allIdsValid) {
        return { valid: false, message: 'IDs de Chromebook inválidos.' };
    }
    return { valid: true };
}

export function confirmarReservas(nome, data, periodos, chromebookIds, reservas, pin, ip) {
    const validation = validateReservaInput(nome, data, periodos, chromebookIds);
    if (!validation.valid) {
        return { success: false, message: validation.message, reservas };
    }
    const userPin = pin || getOrCreateUserPin();
    const batch = buildReservationBatch(nome.trim(), data, periodos, userPin, ip);

    const hasConflict = periodos.some((periodo) =>
        chromebookIds.some((chromebookId) =>
            isChromebookOcupado(reservas, chromebookId, data, periodo.toString())
        )
    );
    if (hasConflict) {
        return {
            success: false,
            message: 'Um ou mais Chromebooks já estão reservados para a data e período selecionados.',
            reservas
        };
    }

    const newReservations = [...reservas];
    chromebookIds.forEach((chromebookId) => {
        periodos.forEach((periodo) => {
            newReservations.push(
                buildReservationObject(nome.trim(), data, periodo.toString(), chromebookId, userPin, ip, batch.id)
            );
        });
    });
    return { success: true, reservas: newReservations, batch };
}

// ============================================================
// Supabase — headers padrão
// ============================================================
function supabaseHeaders() {
    return {
        apikey: SUPABASE_API_KEY,
        Authorization: `Bearer ${SUPABASE_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
    };
}

// ============================================================
// Supabase — carregar reservas do dia ativo (NOVO)
// ============================================================
export async function loadReservasFromSupabase(data) {
    const url = `${SUPABASE_URL}/rest/v1/${SUPABASE_ITEM_TABLE}` +
        `?data=eq.${data}&status=eq.active&select=*`;
    const response = await fetch(url, {
        method: 'GET',
        headers: supabaseHeaders()
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Erro ao carregar reservas: ${response.status} ${body}`);
    }
    return await response.json(); // array de reservation_items
}

// ============================================================
// Supabase — salvar lote + itens (NOVO)
// ============================================================
export async function saveReservaToSupabase(batch, items) {
    // 1. Inserir o batch
    const batchPayload = {
        id: batch.id,
        professor: batch.professor,
        date: batch.date,
        periods: batch.periods,
        pin: batch.pin,
        device_ip: batch.device_ip,
        created_at: batch.created_at,
        updated_at: batch.updated_at
    };
    const batchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/${SUPABASE_BATCH_TABLE}`,
        {
            method: 'POST',
            headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
            body: JSON.stringify(batchPayload)
        }
    );
    if (!batchRes.ok) {
        const body = await batchRes.text();
        throw new Error(`Erro ao salvar lote: ${batchRes.status} ${body}`);
    }

    // 2. Inserir todos os itens em uma única chamada (bulk insert)
    const itemsPayload = items.map((item) => ({
        id: item.id,
        batch_id: item.batch_id,
        professor: item.professor,
        chromebook_id: item.chromebook_id,
        data: item.data,
        periodo: item.periodo,
        pin: item.pin,
        ip: item.ip || null,
        status: item.status,
        created_at: item.created_at
    }));
    const itemsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/${SUPABASE_ITEM_TABLE}`,
        {
            method: 'POST',
            headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
            body: JSON.stringify(itemsPayload)
        }
    );
    if (!itemsRes.ok) {
        const body = await itemsRes.text();
        throw new Error(`Erro ao salvar itens: ${itemsRes.status} ${body}`);
    }
}

// ============================================================
// Supabase — cancelar reservas de um batch (NOVO / BUG CORRIGIDO)
// BUG CORRIGIDO: antes só removia localmente, sem persistir no banco
// ============================================================
export async function cancelReservaOnSupabase(batchId) {
    // Deleta todos os itens do batch (CASCADE já remove o batch pai,
    // mas fazemos DELETE explícito nos itens primeiro por segurança)
    const itemsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/${SUPABASE_ITEM_TABLE}?batch_id=eq.${batchId}`,
        {
            method: 'DELETE',
            headers: supabaseHeaders()
        }
    );
    if (!itemsRes.ok) {
        const body = await itemsRes.text();
        throw new Error(`Erro ao cancelar itens: ${itemsRes.status} ${body}`);
    }

    // Deleta o batch
    const batchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/${SUPABASE_BATCH_TABLE}?id=eq.${batchId}`,
        {
            method: 'DELETE',
            headers: supabaseHeaders()
        }
    );
    if (!batchRes.ok) {
        const body = await batchRes.text();
        throw new Error(`Erro ao cancelar lote: ${batchRes.status} ${body}`);
    }
}

// ============================================================
// Supabase — teste de conexão
// ============================================================
export async function testSupabaseConnection() {
    if (typeof fetch !== 'function') {
        throw new Error('fetch não disponível neste ambiente.');
    }
    const endpoint = `${SUPABASE_URL}/rest/v1/${SUPABASE_BATCH_TABLE}?select=*&limit=1`;
    const response = await fetch(endpoint, {
        method: 'GET',
        headers: supabaseHeaders()
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Falha na comunicação com o Supabase: ${response.status} ${body}`);
    }
    return await response.json();
}

// ============================================================
// UI — Alertas
// ============================================================
function showAlert(message, type = 'info') {
    const overlay  = document.getElementById('alert-overlay');
    const card     = document.getElementById('alert-card');
    const heading  = document.getElementById('alert-heading');
    const content  = document.getElementById('alert-message');
    if (!overlay || !card || !heading || !content) {
        window.alert(message);
        return;
    }
    heading.textContent = type === 'error' ? 'Erro' : type === 'success' ? 'Sucesso' : 'Aviso';
    content.textContent = message;
    card.classList.remove('info', 'success', 'error');
    card.classList.add(type);
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    logger.info('ui', 'Alert exibido', { type, message });
    if (alertTimeoutId) clearTimeout(alertTimeoutId);
    alertTimeoutId = window.setTimeout(hideAlert, ALERT_HIDE_DELAY);
}

function hideAlert() {
    const overlay = document.getElementById('alert-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
        logger.debug('ui', 'Alert fechado');
    }
    if (alertTimeoutId) {
        clearTimeout(alertTimeoutId);
        alertTimeoutId = null;
    }
}

// ============================================================
// UI — Modal de informações da reserva
// ============================================================
function showReservationInfo(reservation, canCancel = false) {
    const overlay   = document.getElementById('info-overlay');
    const heading   = document.getElementById('info-heading');
    const content   = document.getElementById('info-message');
    const cancelBtn = document.getElementById('info-cancel-btn');
    if (!overlay || !heading || !content || !cancelBtn) return;
    state.pendingCancellationReservation = reservation;
    heading.textContent = 'Reserva confirmada';
    const horarioFinal = getPeriodoHorario(reservation.periodo);
    content.textContent = `Reservado por: ${reservation.professor} até a ${horarioFinal}`;
    cancelBtn.style.display = canCancel ? 'inline-block' : 'none';
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    logger.info('ui', 'Detalhes de reserva exibidos', {
        professor: reservation.professor,
        periodo: reservation.periodo,
        canCancel
    });
}

function hideReservationInfo() {
    const overlay = document.getElementById('info-overlay');
    state.pendingCancellationReservation = null;
    if (overlay) {
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
        logger.debug('ui', 'Modal de reserva fechado');
    }
}

// ============================================================
// UI — Modal de PIN
// ============================================================
function openPinOverlay(reservation) {
    const overlay  = document.getElementById('pin-overlay');
    const pinText  = document.getElementById('pin-text');
    const pinInput = document.getElementById('pin-input');
    if (!overlay || !pinText || !pinInput) return;
    state.pendingCancellationReservation = reservation;
    pinText.textContent = 'Digite a chave de acesso desta reserva para cancelar.';
    pinInput.value = '';
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    logger.info('ui', 'Modal de PIN aberto para cancelamento', { reservation });
}

function hidePinOverlay() {
    const overlay  = document.getElementById('pin-overlay');
    const pinInput = document.getElementById('pin-input');
    state.pendingCancellationReservation = null;
    if (pinInput) pinInput.value = '';
    if (overlay) {
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
        logger.debug('ui', 'Modal de PIN fechado');
    }
}

// ============================================================
// Lógica de cancelamento — com persistência no Supabase
// BUG CORRIGIDO: antes só removia do state local
// ============================================================
async function cancelReservation(reservation) {
    try {
        await cancelReservaOnSupabase(reservation.batch_id);
    } catch (err) {
        logger.error('reservation', 'Falha ao cancelar no Supabase', { err });
        showAlert('Erro ao cancelar no servidor. Tente novamente.', 'error');
        return;
    }
    state.reservas = state.reservas.filter((item) => item.batch_id !== reservation.batch_id);
    state.batches  = state.batches.filter((batch) => batch.id !== reservation.batch_id);
    state.pendingCancellationReservation = null;
    logger.info('reservation', 'Reserva cancelada', { reservation });
    showAlert('Todas as reservas deste grupo foram canceladas.', 'success');
    hideReservationInfo();
    hidePinOverlay();
    renderGrid();
}

// ============================================================
// UI — Clique no card de Chromebook
// ============================================================
function handleReservationCardClick(reservation) {
    if (!reservation) return;
    if (reservation.pin && reservation.pin === state.userPin) {
        showReservationInfo(reservation, true);
        return;
    }
    openPinOverlay(reservation);
}

function handlePinConfirm() {
    const pinInput = document.getElementById('pin-input');
    if (!pinInput || !state.pendingCancellationReservation) return;
    const enteredPin = pinInput.value.trim();
    if (enteredPin === state.pendingCancellationReservation.pin) {
        cancelReservation(state.pendingCancellationReservation);
        return;
    }
    logger.warn('reservation', 'PIN inválido para cancelamento', { enteredPin });
    showAlert('PIN incorreto. Tente novamente.', 'error');
}

// ============================================================
// UI — Grade principal de Chromebooks
// ============================================================
export function renderGrid() {
    const grid   = document.getElementById('main-grid');
    const select = document.getElementById('view-periodo');
    if (!grid || !select) return;
    const periodoSelecionado = select.value;
    // BUG CORRIGIDO: getOcupadosParaDataPeriodo já retorna Numbers,
    // então o Set e o loop usam o mesmo tipo
    const ocupadosSet = new Set(
        getOcupadosParaDataPeriodo(state.reservas, state.dataAtiva, periodoSelecionado)
    );
    grid.innerHTML = '';
    for (let i = 1; i <= TOTAL_CHROMEBOOKS; i += 1) {
        const ocupado = ocupadosSet.has(i); // i é Number, Set contém Numbers ✓
        const reserva = ocupado
            ? getReservaParaItem(state.reservas, i, state.dataAtiva, periodoSelecionado)
            : null;
        const card = document.createElement('div');
        card.className = `chrome-card ${ocupado ? 'occupied clickable' : 'available'}`;
        const statusSpan = document.createElement('span');
        statusSpan.style.color = ocupado ? 'var(--danger)' : 'var(--success)';
        statusSpan.textContent = ocupado ? 'Ocupado' : 'Livre';
        const label = document.createElement('b');
        label.textContent = `Nº ${i}`;
        card.append(statusSpan, label);
        if (ocupado && reserva) {
            card.addEventListener('click', () => handleReservationCardClick(reserva));
        }
        grid.appendChild(card);
    }
    logger.debug('ui', 'Grade renderizada', {
        date: state.dataAtiva,
        period: periodoSelecionado,
        occupiedCount: ocupadosSet.size
    });
}

// ============================================================
// UI — Seletor de datas
// ============================================================
export function initDates() {
    const container = document.getElementById('dates-container');
    if (!container) return;
    const dates = generateFutureBusinessDates(getAgora(), 7);
    container.innerHTML = '';
    dates.forEach((date, index) => {
        const iso    = date.toLocaleDateString('en-CA');
        const active = index === 0 ? 'active' : '';
        if (index === 0) state.dataAtiva = iso;
        const item    = document.createElement('div');
        item.className = `date-item ${active}`;
        const weekday = document.createElement('span');
        weekday.textContent = date.toLocaleDateString('pt-BR', { weekday: 'short' });
        const day = document.createElement('b');
        day.textContent = `${date.getDate()}`;
        item.append(weekday, day);
        item.addEventListener('click', () => selectDate(item, iso));
        container.appendChild(item);
    });
    logger.info('ui', 'Datas inicializadas', {
        dates: dates.map((d) => d.toLocaleDateString('en-CA'))
    });
}

function updateReservationDateInput(date) {
    const dateInput = document.getElementById('res-data-input');
    if (dateInput) dateInput.value = date;
}

export async function selectDate(element, date) {
    document.querySelectorAll('.date-item').forEach((item) => item.classList.remove('active'));
    element.classList.add('active');
    state.dataAtiva = date;
    updateReservationDateInput(date);
    logger.event('ui', 'Data selecionada', { date });
    // NOVO: recarrega reservas do Supabase ao trocar de data
    await loadReservasParaDataAtiva();
    renderGrid();
}

// ============================================================
// UI — Modal de reserva
// ============================================================
function renderModalChromebooks() {
    const selectionGrid = document.getElementById('modal-selection-grid');
    if (!selectionGrid) return;
    const unavailable = getOcupadosParaPeriodos(state.reservas, state.dataAtiva, state.selectedHours);
    state.selectedChromebooks = state.selectedChromebooks.filter((id) => !unavailable.includes(id));
    selectionGrid.innerHTML = '';
    for (let i = 1; i <= TOTAL_CHROMEBOOKS; i += 1) {
        const isSelected    = state.selectedChromebooks.includes(i);
        const isUnavailable = unavailable.includes(i);
        const item   = document.createElement('div');
        item.className = `select-item${isSelected ? ' selected' : ''}${isUnavailable ? ' disabled' : ''}`;
        const label  = document.createTextNode(`Nº ${i}`);
        const br     = document.createElement('br');
        const status = document.createElement('b');
        status.textContent = isUnavailable ? 'Ocupado' : '+';
        item.append(label, br, status);
        if (!isUnavailable) {
            item.addEventListener('click', () => {
                const index = state.selectedChromebooks.indexOf(i);
                if (index > -1) {
                    state.selectedChromebooks.splice(index, 1);
                } else {
                    state.selectedChromebooks.push(i);
                }
                renderModalChromebooks();
                logger.debug('ui', 'Chromebook selecionado no modal', {
                    chromebook: i,
                    selectedCount: state.selectedChromebooks.length
                });
            });
        }
        selectionGrid.appendChild(item);
    }
}

export function openModal() {
    const overlay    = document.getElementById('modal-overlay');
    const confirmBtn = document.getElementById('confirm-reservation-btn');
    if (!overlay) return;
    state.selectedChromebooks = [];
    state.selectedHours = [];
    const nomeInput = document.getElementById('prof-nome');
    if (nomeInput) nomeInput.value = '';
    if (confirmBtn) confirmBtn.disabled = false;
    document.querySelectorAll('.hour-chip').forEach((chip) => chip.classList.remove('selected'));
    updateReservationDateInput(state.dataAtiva);
    renderModalChromebooks();
    updateHourChipsState();
    overlay.style.display = 'flex';
    logger.event('ui', 'Modal de reserva aberto');
}

export function closeModal() {
    const overlay    = document.getElementById('modal-overlay');
    const nomeInput  = document.getElementById('prof-nome');
    const confirmBtn = document.getElementById('confirm-reservation-btn');
    if (nomeInput) nomeInput.value = '';
    state.selectedChromebooks = [];
    state.selectedHours = [];
    if (confirmBtn) confirmBtn.disabled = false;
    document.querySelectorAll('.hour-chip').forEach((chip) => chip.classList.remove('selected'));
    if (overlay) overlay.style.display = 'none';
    logger.event('ui', 'Modal de reserva fechado');
}

export function toggleHour(element, hour) {
    // Bloquear seleção de período já expirado no dia atual
    if (isPeriodoExpirado(state.dataAtiva, hour)) {
        showAlert('Este período já passou e não pode ser reservado.', 'error');
        return;
    }
    const index = state.selectedHours.indexOf(hour);
    if (index > -1) {
        state.selectedHours.splice(index, 1);
        element.classList.remove('selected');
        logger.debug('ui', 'Período removido', { hour, selectedHours: state.selectedHours });
    } else {
        state.selectedHours.push(hour);
        element.classList.add('selected');
        logger.debug('ui', 'Período selecionado', { hour, selectedHours: state.selectedHours });
    }
    renderModalChromebooks();
}

// Aplica visual de desabilitado nos chips de período já expirados
function updateHourChipsState() {
    document.querySelectorAll('.hour-chip').forEach((chip) => {
        const hour = chip.dataset.h;
        const expirado = isPeriodoExpirado(state.dataAtiva, hour);
        chip.classList.toggle('disabled', expirado);
        chip.title = expirado ? 'Período já encerrado' : '';
        if (expirado) {
            // Remove da seleção caso já estivesse marcado
            const idx = state.selectedHours.indexOf(hour);
            if (idx > -1) {
                state.selectedHours.splice(idx, 1);
                chip.classList.remove('selected');
            }
        }
    });
}

function renderPeriodoOptions() {
    const select = document.getElementById('view-periodo');
    if (!select) return;
    select.innerHTML = '';
    PERIODOS.forEach((periodo) => {
        const option = document.createElement('option');
        option.value = periodo.value;
        option.textContent = periodo.label;
        select.appendChild(option);
    });
    logger.debug('ui', 'Opções de período renderizadas', { count: PERIODOS.length });
}

function autoSelectPeriodoAndRender() {
    const agora  = getAgora();
    const select = document.getElementById('view-periodo');
    if (!select) return;
    const periodo = getPeriodoFromTime(agora.getHours(), agora.getMinutes());
    if (periodo) {
        select.value = periodo;
        logger.info('ui', 'Período selecionado automaticamente', {
            period: select.value,
            time: `${agora.getHours()}:${agora.getMinutes()}`
        });
    } else {
        logger.warn('ui', 'Nenhum período automático disponível para hora atual', {
            time: `${agora.getHours()}:${agora.getMinutes()}`
        });
    }
    renderGrid();
}

// ============================================================
// Confirmação de reserva — com persistência no Supabase
// BUG CORRIGIDO: try/finally garante que o botão sempre é reabilitado
// ============================================================
async function handleConfirmReservation() {
    const confirmBtn = document.getElementById('confirm-reservation-btn');
    if (confirmBtn) confirmBtn.disabled = true;

    try {
        const nome     = document.getElementById('prof-nome')?.value || '';
        const dataRes  = document.getElementById('res-data-input')?.value || state.dataAtiva;
        const deviceIp = await ensureDeviceIp();

        const result = confirmarReservas(
            nome, dataRes, state.selectedHours, state.selectedChromebooks,
            state.reservas, undefined, deviceIp
        );

        if (!result.success) {
            logger.warn('reservation', 'Falha ao confirmar reserva', {
                reason: result.message, nome, dataRes,
                selectedHours: state.selectedHours,
                selectedChromebooks: state.selectedChromebooks
            });
            showAlert(result.message, 'error');
            return;
        }

        // Montar itens completos para salvar no Supabase
        const batch = result.batch;
        const items = [];
        state.selectedChromebooks.forEach((chromebookId) => {
            state.selectedHours.forEach((periodo) => {
                items.push(buildReservationItem(
                    batch.id, nome.trim(), dataRes,
                    periodo.toString(), chromebookId,
                    batch.pin, deviceIp
                ));
            });
        });

        // Persistir no Supabase
        await saveReservaToSupabase(batch, items);

        // Atualizar state local com os itens efetivamente criados
        state.reservas = [...result.reservas];
        state.batches.push(batch);

        logger.info('reservation', 'Reserva confirmada e salva', {
            professor: nome,
            data: dataRes,
            periods: state.selectedHours,
            chromebooks: state.selectedChromebooks,
            totalReservations: state.reservas.length
        });

        showAlert('Reserva concluída!', 'success');
        closeModal();
        renderGrid();

    } catch (err) {
        // BUG CORRIGIDO: erro de rede ou exceção não deixa mais o botão travado
        logger.error('reservation', 'Erro inesperado ao confirmar reserva', { err });
        showAlert('Erro ao salvar reserva. Verifique sua conexão e tente novamente.', 'error');
    } finally {
        // BUG CORRIGIDO: botão sempre reabilitado, seja em sucesso ou erro
        if (confirmBtn) confirmBtn.disabled = false;
    }
}

// ============================================================
// NOVO — Carregar reservas do Supabase para a data ativa
// ============================================================
async function loadReservasParaDataAtiva() {
    try {
        const itens = await loadReservasFromSupabase(state.dataAtiva);
        // Normalizar chromebook_id para Number ao vir do banco
        state.reservas = itens.map((item) => ({
            ...item,
            chromebook_id: Number(item.chromebook_id)
        }));
        logger.info('supabase', 'Reservas carregadas', {
            date: state.dataAtiva,
            count: state.reservas.length
        });
    } catch (err) {
        logger.error('supabase', 'Falha ao carregar reservas', { err });
        showAlert('Não foi possível carregar as reservas. Verifique sua conexão.', 'error');
    }
}

// ============================================================
// Eventos do modal
// ============================================================
function attachModalEvents() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) {
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeModal();
        });
    }
    document.querySelectorAll('.hour-chip').forEach((chip) => {
        const hour = chip.dataset.h;
        chip.addEventListener('click', () => toggleHour(chip, hour));
    });
}

// ============================================================
// Inicialização da aplicação
// ============================================================
async function initApp() {
    logger.init({ appName: 'ReservasLabMovel', level: 'debug', persist: true });
    logger.info('system', 'Aplicação iniciada');

    renderPeriodoOptions();
    initDates();
    attachModalEvents();

    // NOVO: carrega reservas do Supabase antes de renderizar
    await loadReservasParaDataAtiva();
    autoSelectPeriodoAndRender();

    document.getElementById('view-periodo')?.addEventListener('change', renderGrid);
    document.getElementById('open-modal-btn')?.addEventListener('click', openModal);
    document.getElementById('close-modal-btn')?.addEventListener('click', closeModal);
    document.getElementById('confirm-reservation-btn')?.addEventListener('click', handleConfirmReservation);
    document.getElementById('alert-close-btn')?.addEventListener('click', hideAlert);
    document.getElementById('alert-overlay')?.addEventListener('click', (event) => {
        if (event.target.id === 'alert-overlay') hideAlert();
    });
    document.getElementById('info-close-btn')?.addEventListener('click', hideReservationInfo);
    document.getElementById('info-cancel-btn')?.addEventListener('click', () => {
        if (state.pendingCancellationReservation) {
            cancelReservation(state.pendingCancellationReservation);
        }
    });
    document.getElementById('info-overlay')?.addEventListener('click', (event) => {
        if (event.target.id === 'info-overlay') hideReservationInfo();
    });
    document.getElementById('pin-confirm-btn')?.addEventListener('click', handlePinConfirm);
    document.getElementById('pin-cancel-btn')?.addEventListener('click', hidePinOverlay);
    document.getElementById('pin-overlay')?.addEventListener('click', (event) => {
        if (event.target.id === 'pin-overlay') hidePinOverlay();
    });

    hideAlert();
    updateReservationDateInput(state.dataAtiva);
}

if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('DOMContentLoaded', initApp);
}