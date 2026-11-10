import type { VehicleType } from "../generated/prisma/enums.js";
import { AppError } from "./App.Error.js";

// Reglas de la licencia de conducción que dependen de la ley de cada país. Un país sin reglas aquí acepta cualquier
// categoría de 1 a 3 letras o números (el admin la revisa al aprobar al conductor): agregar un país no exige código

interface LicenseRules {
    categories: readonly string[];
    // Las que permiten manejar un camión
    heavy: readonly string[];
}

const RULES: Record<string, LicenseRules> = {
    // Colombia: B particular, C servicio público. B1/C1 cubren camionetas y furgones livianos (tipo NHR);
    // el camión sencillo pide B2/C2 o superior
    CO: { categories: ["B1", "B2", "B3", "C1", "C2", "C3"], heavy: ["B2", "B3", "C2", "C3"] },
};

export const isHeavyLicense = (countryCode: string, category: string | null | undefined) => {
    const rules = RULES[countryCode];
    return rules ? rules.heavy.includes(category ?? "") : true;
}

// Categoría válida en el país y suficiente para el tipo de vehículo
export const checkLicense = (countryCode: string, category: string, vehicleType: VehicleType) => {
    const rules = RULES[countryCode];
    if (rules && !rules.categories.includes(category)) {
        throw new AppError("LICENSE_CATEGORY_INVALID", 400);
    }
    if (vehicleType === "CAMION" && !isHeavyLicense(countryCode, category)) {
        throw new AppError("TRUCK_NEEDS_LICENSE", 400);
    }
}
