// Corre todas las pruebas de integración en orden y resume el resultado. Uso: npm test (con el backend corriendo)
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const SUITES = ["security.test.mjs", "negotiation.test.mjs", "accounts.test.mjs", "photos-delivery.test.mjs", "chat-ratings-incidents.test.mjs", "payments.test.mjs", "vehicle.test.mjs", "admin.test.mjs", "language.test.mjs", "i18n.test.mts"];

const failed = [];
for (const suite of SUITES) {
    console.log(`\n=== ${suite}`);
    const file = fileURLToPath(new URL(`./${suite}`, import.meta.url));
    // Las pruebas .mts importan código de src/ (TypeScript): corren con tsx
    const args = suite.endsWith(".mts") ? ["--import", "tsx", file] : [file];
    const { status } = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
    if (status !== 0) failed.push(suite);
}

console.log(failed.length ? `\nFallaron: ${failed.join(", ")}` : `\nLas ${SUITES.length} suites pasaron`);
process.exit(failed.length ? 1 : 0);
