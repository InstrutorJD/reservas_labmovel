import assert from 'assert';
import { ENABLE_MOCK_DATA_TESTS } from './mockConfig.js';
import { logger } from '../logger.js';
import {
    getAgora,
    getPeriodoFromTime,
    generateFutureBusinessDates,
    validateReservaInput,
    isChromebookOcupado,
    confirmarReservas,
    buildReservationObject,
    getOcupadosParaDataPeriodo
} from '../script.js';

function testGetAgoraMocked() {
    const agora = getAgora({ useMock: true, hour: 8, minute: 5 });
    assert.strictEqual(agora.getHours(), 8, 'Hora simulada deve ser 08');
    assert.strictEqual(agora.getMinutes(), 5, 'Minuto simulado deve ser 05');
}

function testGetPeriodoFromTime() {
    assert.strictEqual(getPeriodoFromTime(7, 10), '1');
    assert.strictEqual(getPeriodoFromTime(8, 10), '2');
    assert.strictEqual(getPeriodoFromTime(9, 30), '3');
    assert.strictEqual(getPeriodoFromTime(12, 30), '6');
    assert.strictEqual(getPeriodoFromTime(13, 30), '7');
    assert.strictEqual(getPeriodoFromTime(14, 0), null);
}

function testGenerateFutureBusinessDates() {
    const start = new Date('2026-04-10T12:00:00'); // Friday
    const dates = generateFutureBusinessDates(start, 7);
    assert.strictEqual(dates.length, 7, 'Deve gerar 7 dias úteis');
    assert.strictEqual(dates[0].toISOString().split('T')[0], '2026-04-10', 'Primeiro dia deve ser o próprio dia útil');
    assert.deepStrictEqual(dates.map((date) => date.toISOString().split('T')[0]), [
        '2026-04-10',
        '2026-04-13',
        '2026-04-14',
        '2026-04-15',
        '2026-04-16',
        '2026-04-17',
        '2026-04-20'
    ]);
}

function testValidateReservaInput() {
    const errorNome = validateReservaInput('', '2026-04-10', [1], [1]);
    assert.strictEqual(errorNome.valid, false);
    const errorData = validateReservaInput('João', '', [1], [1]);
    assert.strictEqual(errorData.valid, false);
    const errorPeriodo = validateReservaInput('João', '2026-04-10', [], [1]);
    assert.strictEqual(errorPeriodo.valid, false);
    const errorChromebook = validateReservaInput('João', '2026-04-10', [1], []);
    assert.strictEqual(errorChromebook.valid, false);
    const ok = validateReservaInput('João', '2026-04-10', [1], [1]);
    assert.strictEqual(ok.valid, true);
}

function testBuildReservationObject() {
    const reserva = buildReservationObject('Maria', '2026-04-10', '2', 5);
    assert.deepStrictEqual(reserva, {
        professor: 'Maria',
        chromebook_id: 5,
        data: '2026-04-10',
        periodo: '2'
    });
}

function testConfirmarReservas() {
    const initial = [];
    const result = confirmarReservas('Maria', '2026-04-10', [2, 3], [1, 2], initial);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.reservas.length, 4);
    assert.strictEqual(result.reservas[0].periodo, '2');
}

function testConfirmarReservasConflito() {
    const initial = [
        { professor: 'Teste', data: '2026-04-10', periodo: '2', chromebook_id: 1 }
    ];
    const result = confirmarReservas('João', '2026-04-10', [2], [1], initial);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.message, 'Um ou mais Chromebooks já estão reservados para a data e período selecionados.');
}

function testOcupacao() {
    const reservas = [
        { data: '2026-04-10', periodo: '1', chromebook_id: 3 },
        { data: '2026-04-10', periodo: '1', chromebook_id: 5 }
    ];
    assert.strictEqual(isChromebookOcupado(reservas, 3, '2026-04-10', '1'), true);
    assert.strictEqual(isChromebookOcupado(reservas, 4, '2026-04-10', '1'), false);
    const ocupados = getOcupadosParaDataPeriodo(reservas, '2026-04-10', '1');
    assert.deepStrictEqual(ocupados, [3, 5]);
}

function testLoggerModule() {
    logger.init({ appName: 'test', level: 'debug', persist: false });
    logger.clear();
    logger.debug('tests', 'Logger de teste ativo', { value: 42 });
    const logs = logger.getLogs();
    assert.strictEqual(logs.length, 2, 'O logger deve registrar duas entradas após limpar e adicionar debug');
    assert.strictEqual(logs[1].tag, 'tests');
    assert.strictEqual(logs[1].message, 'Logger de teste ativo');
}

function testMockDataEnabledBehaviour() {
    if (!ENABLE_MOCK_DATA_TESTS) {
        console.log('Mock data tests estão desabilitados. Para habilitar, abra tests/mockConfig.js e altere ENABLE_MOCK_DATA_TESTS para true.');
        return;
    }
    const agora = getAgora({ useMock: true, hour: 9, minute: 0 });
    assert.strictEqual(agora.getHours(), 9);
    assert.strictEqual(agora.getMinutes(), 0);
}

export async function runTests() {
    const tests = [
        testGetAgoraMocked,
        testGetPeriodoFromTime,
        testGenerateFutureBusinessDates,
        testValidateReservaInput,
        testBuildReservationObject,
        testConfirmarReservas,
        testOcupacao,
        testLoggerModule,
        testMockDataEnabledBehaviour
    ];

    let passed = 0;
    for (const test of tests) {
        try {
            await test();
            passed += 1;
            console.log(`✅ ${test.name}`);
        } catch (error) {
            console.error(`❌ ${test.name}`);
            throw error;
        }
    }
    console.log(`\n${passed}/${tests.length} testes executados com sucesso.`);
}
