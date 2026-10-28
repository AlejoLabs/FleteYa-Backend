import type { VehicleType } from "../generated/prisma/enums.js";
import { AppError } from "./App.Error.js";

// De menor a mayor. Un conductor ve las cargas de su tipo de vehículo y de los más pequeños
export const VEHICLE_ORDER: VehicleType[] = ["CARRY", "ESTACAS", "FURGON", "CAMION"];

// Capacidad aproximada de cada tipo de vehículo de carga en Colombia
export const VEHICLE_CAPACITY: Record<VehicleType, { label: string; max_weight_kg: number; max_volume_m3: number; max_length_cm: number }> = {
    CARRY:   { label: "Carry",                 max_weight_kg: 700,   max_volume_m3: 3,  max_length_cm: 200 },
    ESTACAS: { label: "Camioneta de estacas",  max_weight_kg: 2000,  max_volume_m3: 12, max_length_cm: 400 },
    FURGON:  { label: "Furgón",                max_weight_kg: 4500,  max_volume_m3: 20, max_length_cm: 500 },
    CAMION:  { label: "Camión",                max_weight_kg: 10000, max_volume_m3: 45, max_length_cm: 800 },
};

export const vehicleRank = (type: VehicleType) => VEHICLE_ORDER.indexOf(type);

interface CargoSize {
    weight_kg?: number | undefined;
    length_cm?: number | undefined;
    width_cm?: number | undefined;
    height_cm?: number | undefined;
    packages?: number | undefined;
}

// Las medidas son las del bulto más grande; el volumen total se estima multiplicándolo por el número de bultos
export const requiredVehicleFor = (cargo: CargoSize): VehicleType => {
    const weight = cargo.weight_kg ?? 0;
    const longest = Math.max(cargo.length_cm ?? 0, cargo.width_cm ?? 0, cargo.height_cm ?? 0);
    const volume = ((cargo.length_cm ?? 0) * (cargo.width_cm ?? 0) * (cargo.height_cm ?? 0) / 1_000_000) * (cargo.packages ?? 1);

    const fits = VEHICLE_ORDER.find((type) => {
        const cap = VEHICLE_CAPACITY[type];
        return weight <= cap.max_weight_kg && volume <= cap.max_volume_m3 && longest <= cap.max_length_cm;
    });
    if (!fits) {
        throw new AppError("La carga supera la capacidad de un camión sencillo; divídela en varios fletes", 400);
    }
    return fits;
}

export const biggerVehicle = (a: VehicleType, b: VehicleType): VehicleType => vehicleRank(a) >= vehicleRank(b) ? a : b;
