// Genera el SQL con el área de cada país a partir de Natural Earth (dominio público, escala 1:10 millones):
//   node scripts/countries/build-areas.mjs <ne_10m_admin_0_countries.geojson> CO MX US ...
// Escribe en la salida un UPDATE countries SET area = ... por país. El archivo de Natural Earth no va en el repo:
// https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_admin_0_countries.geojson
//
// Para que la migración no pese de más: los países grandes se simplifican con una tolerancia de ~500 m (~1 km los enormes), los pequeños
// (Mónaco, San Marino, Andorra...) se dejan como vienen, se descartan los islotes de menos de ~5 km² (el territorio
// principal se conserva siempre) y las coordenadas se redondean a 4 decimales (~11 m)
import fs from "fs";

const [file, ...codes] = process.argv.slice(2);
if (!file || !codes.length) {
    console.error("Uso: node scripts/countries/build-areas.mjs <archivo.geojson> CO MX ...");
    process.exit(1);
}

const TOLERANCE = 0.005;
// Los países enormes (Estados Unidos, Brasil, Australia...) con ~1 km: sus costas pesan más que todo lo demás junto
const HUGE_COUNTRY = 20;
const HUGE_TOLERANCE = 0.01;
// Un país que cabe en menos de este tamaño (en grados) no se simplifica
const SMALL_COUNTRY = 1;
const MIN_AREA = 0.0005;

// Douglas-Peucker sobre un anillo cerrado
const simplify = (points, tolerance) => {
    if (points.length <= 4 || tolerance === 0) return points;
    const keep = new Array(points.length).fill(false);
    keep[0] = keep[points.length - 1] = true;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
        const [first, last] = stack.pop();
        const [x1, y1] = points[first], [x2, y2] = points[last];
        const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy);
        let max = 0, index = -1;
        for (let i = first + 1; i < last; i++) {
            const [x, y] = points[i];
            const distance = length === 0 ? Math.hypot(x - x1, y - y1) : Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / length;
            if (distance > max) { max = distance; index = i; }
        }
        if (max > tolerance) {
            keep[index] = true;
            stack.push([first, index], [index, last]);
        }
    }
    return points.filter((_, i) => keep[i]);
};

// ¿Algún par de lados no vecinos de los anillos de un polígono se cruza? (MySQL rechaza esos polígonos).
// Barrido por x: cada lado solo se compara con los que se solapan con él en x
const crosses = (rings) => {
    const segments = [];
    rings.forEach((ring, r) => {
        for (let i = 0; i < ring.length - 1; i++) segments.push({ r, i, n: ring.length - 1, a: ring[i], b: ring[i + 1], minX: Math.min(ring[i][0], ring[i + 1][0]), maxX: Math.max(ring[i][0], ring[i + 1][0]) });
    });
    segments.sort((s1, s2) => s1.minX - s2.minX);
    const orient = ([ax, ay], [bx, by], [cx, cy]) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    for (let i = 0; i < segments.length; i++) {
        const s1 = segments[i];
        for (let j = i + 1; j < segments.length && segments[j].minX <= s1.maxX; j++) {
            const s2 = segments[j];
            // Lados seguidos del mismo anillo comparten un punto: no cuentan
            if (s1.r === s2.r && (Math.abs(s1.i - s2.i) === 1 || Math.abs(s1.i - s2.i) === s1.n - 1)) continue;
            const o1 = orient(s1.a, s1.b, s2.a), o2 = orient(s1.a, s1.b, s2.b), o3 = orient(s2.a, s2.b, s1.a), o4 = orient(s2.a, s2.b, s1.b);
            if (o1 !== o2 && o3 !== o4 && o1 * o2 <= 0 && o3 * o4 <= 0) return true;
        }
    }
    return false;
};

const area = (ring) => Math.abs(ring.reduce((sum, [x1, y1], i) => {
    const [x2, y2] = ring[(i + 1) % ring.length];
    return sum + x1 * y2 - x2 * y1;
}, 0)) / 2;

const span = (ring) => {
    const xs = ring.map(([x]) => x), ys = ring.map(([, y]) => y);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
};

const round = (value) => Number(value.toFixed(4));

// Redondea y quita los puntos repetidos seguidos (el redondeo puede juntar dos). Un anillo con menos de 4 puntos
// (un islote de pocos metros) deja de ser un polígono válido: se descarta
const roundRing = (ring) => ring.map(([x, y]) => `${round(x)} ${round(y)}`).filter((point, i, all) => i === 0 || point !== all[i - 1]);
const isRing = (points) => points.length >= 4 && points[0] === points[points.length - 1];

const countries = JSON.parse(fs.readFileSync(file, "utf8")).features;
for (const code of codes) {
    // Francia y Noruega traen ISO_A2 = -99 por sus territorios de ultramar; ISO_A2_EH sí trae el código
    const feature = countries.find((item) => item.properties.ISO_A2_EH === code);
    if (!feature) throw new Error(`No está ${code} en el archivo`);
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const largest = Math.max(...polygons.map((rings) => area(rings[0])));
    const size = Math.max(...polygons.map((rings) => span(rings[0])));
    const tolerance = size < SMALL_COUNTRY ? 0 : size > HUGE_COUNTRY ? HUGE_TOLERANCE : TOLERANCE;
    const sources = polygons.filter((rings) => area(rings[0]) === largest || area(rings[0]) >= MIN_AREA);
    const kept = sources
        .map((rings) => {
            // Si al simplificar el borde se cruza consigo mismo, se simplifica menos (hasta dejarlo como viene)
            for (let current = tolerance; ; current /= 2) {
                const value = current < tolerance / 16 ? 0 : current;
                const result = rings.map((ring) => roundRing(simplify(ring, value)));
                const numeric = result.map((ring) => ring.map((point) => point.split(" ").map(Number)));
                if (value === 0 || !crosses(numeric)) return result;
            }
        })
        // Sin su borde exterior el polígono no existe (null, para no mover las posiciones); los huecos inválidos se quitan
        .map((rings) => (isRing(rings[0]) ? rings.filter(isRing) : null));
    // Dos polígonos del mismo país que se cruzan (dos islas pegadas al simplificarlas) hacen inválido el MULTIPOLYGON:
    // se dejan sin simplificar y, si aun así se cruzan, se quita el más pequeño
    const numeric = (rings) => rings.map((ring) => ring.map((point) => point.split(" ").map(Number)));
    const box = (rings) => { const ring = numeric(rings)[0]; const xs = ring.map(([x]) => x), ys = ring.map(([, y]) => y); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; };
    const overlap = (a, b) => { const [ax1, ax2, ay1, ay2] = box(a), [bx1, bx2, by1, by2] = box(b); return ax1 <= bx2 && bx1 <= ax2 && ay1 <= by2 && by1 <= ay2; };
    for (let a = 0; a < kept.length; a++) {
        for (let b = a + 1; b < kept.length; b++) {
            if (!kept[a] || !kept[b] || !overlap(kept[a], kept[b]) || !crosses([...numeric(kept[a]), ...numeric(kept[b])])) continue;
            const raw = (rings) => rings.map(roundRing).filter(isRing);
            const sourceA = raw(sources[a]), sourceB = raw(sources[b]);
            if (!crosses([...numeric(sourceA), ...numeric(sourceB)])) { kept[a] = sourceA; kept[b] = sourceB; continue; }
            if (area(sources[a][0]) < area(sources[b][0])) kept[a] = null; else kept[b] = null;
        }
    }
    const wkt = `MULTIPOLYGON(${kept.filter(Boolean).map((rings) => `(${rings.map((ring) => `(${ring.join(",")})`).join(",")})`).join(",")})`;
    console.log(`UPDATE \`countries\` SET \`area\` = ST_GeomFromText('${wkt}', 4326, 'axis-order=long-lat') WHERE \`code\` = '${code}';`);
}
