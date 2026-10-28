// Corre todas las pruebas de integración en orden y resume el resultado. Uso: npm test (con el backend corriendo)
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const SUITES = ["security.test.mjs", "negotiation.test.mjs", "accounts.test.mjs", "photos-delivery.test.mjs"];

const failed = [];
for (const suite of SUITES) {
    console.log(`\n=== ${suite}`);
    const file = fileURLToPath(new URL(`./${suite}`, import.meta.url));
    const { status } = spawnSync(process.execPath, [file], { stdio: "inherit", env: process.env });
    if (status !== 0) failed.push(suite);
}

console.log(failed.length ? `\nFallaron: ${failed.join(", ")}` : `\nLas ${SUITES.length} suites pasaron`);
process.exit(failed.length ? 1 : 0);
