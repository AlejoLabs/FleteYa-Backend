// Tarifas: valores del precio sugerido y porcentaje de comisión. Los viajes ya acordados no cambian
import { api, failure, h, loading, money, pageHead, toast, VEHICLES, show } from "../ui.js";

const field = (label, name, value, { step = "1", hint, suffix } = {}) =>
  h("label", {}, label,
    h("div", { class: "row", style: { flexWrap: "nowrap" } },
      h("input", { type: "number", name, value, min: 0, step, required: true, style: { width: "100%" } }),
      suffix ? h("span", { class: "muted" }, suffix) : null),
    hint ? h("span", { class: "muted small", style: { fontWeight: 400 } }, hint) : null);

export const renderRates = async (container) => {
  const head = pageHead("Tarifas", "Con qué se calcula el precio sugerido que ve el cliente, y la comisión de FleteYa.");
  show(container, head, loading());
  let rates;
  try {
    rates = await api("GET", "/config");
  } catch (err) {
    return show(container, head, failure(err, () => renderRates(container)));
  }

  const error = h("p", { class: "error", hidden: true });
  const save = h("button", { class: "btn primary", type: "submit" }, "Guardar tarifas");
  const form = h("form", { class: "stack", style: { gap: "20px" } },
    h("div", { class: "grid" },
      h("section", { class: "card" }, h("h2", {}, "Valores por recorrido y carga"),
        field("Valor por kilómetro", "km_value", rates.km_value, { suffix: "$" }),
        field("Valor por minuto de viaje", "min_value", rates.min_value, { suffix: "$" }),
        field("Valor por kilo de carga", "weight_rate", rates.weight_rate, { suffix: "$" }),
        field("Valor por metro cúbico", "size_rate", rates.size_rate, { suffix: "$" })),
      h("section", { class: "card" }, h("h2", {}, "Comisión de FleteYa"),
        field("Porcentaje del valor acordado", "commission", Math.round(rates.commission_rate * 1000) / 10,
          { step: "0.5", suffix: "%", hint: "Se guarda en cada viaje al asignar el conductor: un cambio no afecta los viajes ya acordados." })),
    ),
    h("section", { class: "card" }, h("h2", {}, "Por tipo de vehículo"),
      h("p", { class: "muted small" }, "Precio sugerido = base + (km × valor por km + minutos × valor por minuto) × factor + kilos × valor por kilo + m³ × valor por m³."),
      h("div", { class: "grid" }, rates.vehicle_rates.map((v) => h("div", { class: "stack" },
        h("h3", {}, VEHICLES[v.vehicle_type] ?? v.vehicle_type),
        field("Tarifa base", `base_${v.vehicle_type}`, v.base_fare, { suffix: "$" }),
        field("Factor sobre recorrido", `factor_${v.vehicle_type}`, v.km_factor, { step: "0.1", suffix: "×" }))))),
    error,
    h("div", {}, save));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const num = (name) => Number(data.get(name));
    const body = {
      km_value: num("km_value"), min_value: num("min_value"), weight_rate: num("weight_rate"), size_rate: num("size_rate"),
      commission_rate: Math.round(num("commission") * 10) / 1000,
      vehicle_rates: rates.vehicle_rates.map((v) => ({ vehicle_type: v.vehicle_type, base_fare: num(`base_${v.vehicle_type}`), km_factor: num(`factor_${v.vehicle_type}`) })),
    };
    save.disabled = true;
    error.hidden = true;
    try {
      await api("PUT", "/config", body);
      toast(`Tarifas guardadas. Un carry de 10 km ahora parte de ${money(body.vehicle_rates[0].base_fare + body.km_value * 10 * body.vehicle_rates[0].km_factor)}`, "success");
      renderRates(container);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      save.disabled = false;
    }
  });

  show(container, head, form);
};
