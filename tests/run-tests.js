import { runTests } from './reservas.test.js';

try {
    await runTests();
    process.exit(0);
} catch (error) {
    console.error(error.message || error);
    process.exit(1);
}
