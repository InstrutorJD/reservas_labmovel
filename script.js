import { logger } from './logger.js';

export const MODO_TESTE = true;
export const HORA_SIMULADA = 8;
export const MINUTO_SIMULADO = 5;
export const TOTAL_CHROMEBOOKS = 19;

export const PERIODOS = [
    { value: '1', label: '1h (07:00-07:50)' },
    { value: '2', label: '2h (07:50-08:40)' },
    { value: '3', label: '3h (09:00-09:50)' },
    { value: '4', label: '4h (09:50-10:40)' },
    { value: '5', label: '5h (10:40-11:30)' },
    { value: '6', label: '6h (12:20-13:10)' },
    { value: '7', label: '7h (13:10-14:00)' }
];

export function getAgora({ useMock = MODO_TESTE, hour = HORA_SIMULADA, minute = MINUTO_SIMULADO } = {}) {
    if (useMock) {
        const now = new Date();
        now.setHours(hour, minute, 0, 0);
        return now;
    }
    return new Date();
}

export function getPeriodoFromTime(hour, minute) {
    const minutes = hour * 60 + minute;
    if (minutes >= 420 && minutes < 470) return '1';
    if (minutes >= 470 && minutes < 530) return '2';
    if (minutes >= 540 && minutes < 590) return '3';
    if (minutes >= 590 && minutes < 640) return '4';
    if (minutes >= 640 && minutes < 690) return '5';
    if (minutes >= 740 && minutes < 790) return '6';
    if (minutes >= 790 && minutes < 840) return '7';
    return '1';
}

export function generateFutureBusinessDates(startDate = new Date(), count = 7) {
    const dates = [];
    const today = new Date(startDate);
    today.setHours(0, 0, 0, 0);
    while (dates.length < count) {
        if (today.getDay() !== 0 && today.getDay() !== 6) {
            dates.push(new Date(today));
        }
        today.setDate(today.getDate() + 1);
    }
    return dates;
}

export function getOcupadosParaDataPeriodo(reservas, data, periodo) {
    return reservas
        .filter((reservation) => reservation.data === data && reservation.periodo === periodo)
        .map((reservation) => reservation.chromebook_id);
}

export function isChromebookOcupado(reservas, chromebookId, data, periodo) {
    return getOcupadosParaDataPeriodo(reservas, data, periodo).includes(chromebookId);
}

export function buildReservationObject(nome, data, periodo, chromebookId) {
    return {
        professor: nome,
        chromebook_id: chromebookId,
        data,
        periodo
    };
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
    if (!Array.isArray(chromebookIds) || chromebookIds.length === 0) {
        return { valid: false, message: 'Selecione ao menos um Chromebook.' };
    }
    return { valid: true };
}

export function confirmarReservas(nome, data, periodos, chromebookIds, reservas) {
    const validation = validateReservaInput(nome, data, periodos, chromebookIds);
    if (!validation.valid) {
        return { success: false, message: validation.message, reservas };
    }
    const newReservations = [...reservas];
    chromebookIds.forEach((chromebookId) => {
        periodos.forEach((periodo) => {
            newReservations.push(buildReservationObject(nome.trim(), data, periodo.toString(), chromebookId));
        });
    });
    return { success: true, reservas: newReservations };
}

const state = {
    reservas: [
        { data: getAgora().toISOString().split('T')[0], periodo: '1', chromebook_id: 3, professor: 'Teste' }
    ],
    selectedChromebooks: [],
    selectedHours: [],
    dataAtiva: getAgora().toISOString().split('T')[0]
};

let alertTimeoutId = null;
const ALERT_HIDE_DELAY = 4500;

function setTestModeIndicator() {
    const indicator = document.getElementById('test-indicator');
    if (indicator) {
        indicator.style.display = MODO_TESTE ? 'block' : 'none';
    }
    logger.info('system', 'Modo de teste configurado', { enabled: MODO_TESTE });
}

function showAlert(message, type = 'info') {
    const overlay = document.getElementById('alert-overlay');
    const card = document.getElementById('alert-card');
    const heading = document.getElementById('alert-heading');
    const content = document.getElementById('alert-message');
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

    if (alertTimeoutId) {
        clearTimeout(alertTimeoutId);
    }
    alertTimeoutId = window.setTimeout(() => {
        hideAlert();
    }, ALERT_HIDE_DELAY);
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

function renderPeriodoOptions() {
    const select = document.getElementById('view-periodo');
    if (!select) return;
    select.innerHTML = PERIODOS.map((periodo) => `<option value="${periodo.value}">${periodo.label}</option>`).join('');
    logger.debug('ui', 'Opções de período renderizadas', { count: PERIODOS.length });
}

function autoSelectPeriodoAndRender() {
    const agora = getAgora();
    const select = document.getElementById('view-periodo');
    if (!select) return;
    select.value = getPeriodoFromTime(agora.getHours(), agora.getMinutes());
    logger.info('ui', 'Período selecionado automaticamente', { period: select.value, time: `${agora.getHours()}:${agora.getMinutes()}` });
    renderGrid();
}

export function renderGrid() {
    const grid = document.getElementById('main-grid');
    const select = document.getElementById('view-periodo');
    if (!grid || !select) return;
    const periodoSelecionado = select.value;
    const ocupados = getOcupadosParaDataPeriodo(state.reservas, state.dataAtiva, periodoSelecionado);
    grid.innerHTML = '';
    for (let i = 1; i <= TOTAL_CHROMEBOOKS; i += 1) {
        const ocupado = ocupados.includes(i);
        const card = document.createElement('div');
        card.className = `chrome-card ${ocupado ? 'occupied' : 'available'}`;
        card.innerHTML = `<span style="color: ${ocupado ? 'var(--danger)' : 'var(--success)'}">${ocupado ? 'Ocupado' : 'Livre'}</span><b>Nº ${i}</b>`;
        grid.appendChild(card);
    }
    logger.debug('ui', 'Grade renderizada', { date: state.dataAtiva, period: periodoSelecionado, occupiedCount: ocupados.length });
}

export function initDates() {
    const container = document.getElementById('dates-container');
    if (!container) return;
    const dates = generateFutureBusinessDates(getAgora(), 7);
    container.innerHTML = '';
    dates.forEach((date, index) => {
        const iso = date.toISOString().split('T')[0];
        const active = index === 0 ? 'active' : '';
        state.dataAtiva = index === 0 ? iso : state.dataAtiva;
        const item = document.createElement('div');
        item.className = `date-item ${active}`;
        item.innerHTML = `<span>${date.toLocaleDateString('pt-BR', { weekday: 'short' })}</span><b>${date.getDate()}</b>`;
        item.addEventListener('click', () => selectDate(item, iso));
        container.appendChild(item);
    });
    logger.info('ui', 'Datas inicializadas', { dates: dates.map((date) => date.toISOString().split('T')[0]) });
}

export function selectDate(element, date) {
    document.querySelectorAll('.date-item').forEach((item) => item.classList.remove('active'));
    element.classList.add('active');
    state.dataAtiva = date;
    logger.event('ui', 'Data selecionada', { date });
    renderGrid();
}

export function openModal() {
    const overlay = document.getElementById('modal-overlay');
    const selectionGrid = document.getElementById('modal-selection-grid');
    if (!overlay || !selectionGrid) return;
    state.selectedChromebooks = [];
    state.selectedHours = [];
    document.querySelectorAll('.hour-chip').forEach((chip) => chip.classList.remove('selected'));
    selectionGrid.innerHTML = '';
    for (let i = 1; i <= TOTAL_CHROMEBOOKS; i += 1) {
        const item = document.createElement('div');
        item.className = 'select-item';
        item.innerHTML = `Nº ${i}<br><b>+</b>`;
        item.addEventListener('click', () => {
            const index = state.selectedChromebooks.indexOf(i);
            if (index > -1) {
                state.selectedChromebooks.splice(index, 1);
                item.classList.remove('selected');
            } else {
                state.selectedChromebooks.push(i);
                item.classList.add('selected');
            }
            logger.debug('ui', 'Chromebook selecionado no modal', { chromebook: i, selectedCount: state.selectedChromebooks.length });
        });
        selectionGrid.appendChild(item);
    }
    overlay.style.display = 'flex';
    logger.event('ui', 'Modal de reserva aberto');
}

export function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    logger.event('ui', 'Modal de reserva fechado');
}

export function toggleHour(element, hour) {
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
}

function handleConfirmReservation() {
    const nome = document.getElementById('prof-nome')?.value || '';
    const dataRes = document.getElementById('res-data-input')?.value || state.dataAtiva;
    const result = confirmarReservas(nome, dataRes, state.selectedHours, state.selectedChromebooks, state.reservas);
    if (!result.success) {
        logger.warn('reservation', 'Falha ao confirmar reserva', { reason: result.message, nome, dataRes, selectedHours: state.selectedHours, selectedChromebooks: state.selectedChromebooks });
        showAlert(result.message, 'error');
        return;
    }
    state.reservas = result.reservas;
    logger.info('reservation', 'Reserva confirmada', {
        professor: nome,
        data: dataRes,
        periods: state.selectedHours,
        chromebooks: state.selectedChromebooks,
        totalReservations: state.reservas.length
    });
    showAlert('Reserva concluída!', 'success');
    closeModal();
    renderGrid();
}

function attachModalEvents() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) {
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                closeModal();
            }
        });
    }
    document.querySelectorAll('.hour-chip').forEach((chip) => {
        const hour = parseInt(chip.dataset.h, 10);
        chip.addEventListener('click', () => toggleHour(chip, hour));
    });
}

function initApp() {
    logger.init({ appName: 'ReservasLabMovel', level: 'debug', persist: true });
    logger.info('system', 'Aplicação iniciada');
    setTestModeIndicator();
    renderPeriodoOptions();
    initDates();
    attachModalEvents();
    autoSelectPeriodoAndRender();
    document.getElementById('view-periodo')?.addEventListener('change', renderGrid);
    document.getElementById('open-modal-btn')?.addEventListener('click', openModal);
    document.getElementById('close-modal-btn')?.addEventListener('click', closeModal);
    document.getElementById('confirm-reservation-btn')?.addEventListener('click', handleConfirmReservation);
    document.getElementById('alert-close-btn')?.addEventListener('click', hideAlert);
    document.getElementById('alert-overlay')?.addEventListener('click', (event) => {
        if (event.target.id === 'alert-overlay') {
            hideAlert();
        }
    });
    hideAlert();
    document.getElementById('res-data-input')?.setAttribute('value', state.dataAtiva);
}

if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('DOMContentLoaded', initApp);
}
