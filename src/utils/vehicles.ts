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

// Las medidas son las del artículo más grande; el volumen total se estima multiplicándolo por el número de artículos
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

// Lo máximo que se puede declarar por tipo: un furgón grande llega a unos 45 m³, pero no a lo de una tractomula
export const CAPACITY_LIMITS: Record<VehicleType, { max_weight_kg: number; max_volume_m3: number }> = {
    CARRY:   { max_weight_kg: 1500,  max_volume_m3: 6 },
    ESTACAS: { max_weight_kg: 4500,  max_volume_m3: 25 },
    FURGON:  { max_weight_kg: 9000,  max_volume_m3: 45 },
    CAMION:  { max_weight_kg: 20000, max_volume_m3: 90 },
};

interface DriverVehicle {
    vehicle_type: VehicleType;
    capacity_kg: number | null;
    capacity_m3: number | null;
}

// La capacidad que declaró el conductor o, si no declaró, la típica de su tipo de vehículo
export const vehicleCapacity = (car: DriverVehicle) => {
    const typical = VEHICLE_CAPACITY[car.vehicle_type];
    return {
        max_weight_kg: car.capacity_kg ?? typical.max_weight_kg,
        max_volume_m3: car.capacity_m3 ?? typical.max_volume_m3,
        max_length_cm: typical.max_length_cm,
    };
}

// El conductor puede llevar la carga si su tipo de vehículo alcanza o si cabe en la capacidad que declaró.
// Lo segundo no aplica cuando el cliente pidió a propósito un vehículo más grande que el necesario por tamaño
export const canCarry = (car: DriverVehicle, cargo: CargoSize & { required_vehicle: VehicleType }) => {
    if (vehicleRank(car.vehicle_type) >= vehicleRank(cargo.required_vehicle)) return true;
    if (car.capacity_kg === null && car.capacity_m3 === null) return false;
    let minimum: VehicleType;
    try {
        minimum = requiredVehicleFor(cargo);
    } catch {
        return false;
    }
    if (minimum !== cargo.required_vehicle) return false;
    const capacity = vehicleCapacity(car);
    const longest = Math.max(cargo.length_cm ?? 0, cargo.width_cm ?? 0, cargo.height_cm ?? 0);
    const volume = ((cargo.length_cm ?? 0) * (cargo.width_cm ?? 0) * (cargo.height_cm ?? 0) / 1_000_000) * (cargo.packages ?? 1);
    return (cargo.weight_kg ?? 0) <= capacity.max_weight_kg && volume <= capacity.max_volume_m3 && longest <= capacity.max_length_cm;
}
