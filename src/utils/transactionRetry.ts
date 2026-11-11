// Dos transacciones que escriben las mismas filas a la vez: MySQL cancela una (bloqueo mutuo) y Prisma lanza P2034.
// La prueba de carga lo encontró al ofertar varias veces a la vez el mismo conductor (1,8 % terminaba en error 500).
// Reintentar es seguro porque la transacción completa se deshizo; la espera corta y al azar evita que vuelvan a chocar
const MAX_ATTEMPTS = 3;

const isWriteConflict = (err: any) => err?.code === "P2034";

export const withTransactionRetry = async <T>(work: () => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
        try {
            return await work();
        } catch (err) {
            if (!isWriteConflict(err) || attempt >= MAX_ATTEMPTS) throw err;
            await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 30));
        }
    }
}
