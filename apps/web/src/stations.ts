// Rio metro stations (Linhas 1, 2, 4), from OpenStreetMap on 2026-08-25.
// ponytail: metro only; add BRT stations here if Barra ever matters enough.

export const STATIONS: [name: string, lat: number, lng: number][] = [
  ["Acari", -22.825, -43.3493],
  ["Afonso Pena", -22.91845, -43.21775],
  ["Antero de Quental", -22.98454, -43.22363],
  ["Botafogo", -22.95037, -43.1842],
  ["Cantagalo", -22.97549, -43.19446],
  ["Cardeal Arcoverde", -22.96382, -43.18137],
  ["Carioca", -22.90757, -43.17804],
  ["Catete", -22.92595, -43.17655],
  ["Central do Brasil", -22.90461, -43.19106],
  ["Cidade Nova", -22.90875, -43.2063],
  ["Cinelândia", -22.9109, -43.17568],
  ["Coelho Neto", -22.83187, -43.34292],
  ["Colégio", -22.84266, -43.33455],
  ["Del Castilho", -22.87928, -43.27193],
  ["Engenheiro Rubens Paiva", -22.8163, -43.35848],
  ["Engenho da Rainha", -22.86792, -43.29738],
  ["Estácio", -22.91354, -43.20657],
  ["Flamengo", -22.93718, -43.17854],
  ["General Osório", -22.98212, -43.19644],
  ["Glória", -22.92063, -43.17662],
  ["Inhaúma", -22.87457, -43.28346],
  ["Irajá", -22.84802, -43.32327],
  ["Jardim Oceânico", -23.00683, -43.31096],
  ["Jardim de Alah", -22.98373, -43.21627],
  ["Largo do Machado", -22.93114, -43.17768],
  ["Maracanã", -22.90972, -43.23389],
  ["Maria da Graça", -22.88149, -43.26019],
  ["Nossa Senhora da Paz", -22.98372, -43.20602],
  ["Pavuna", -22.80632, -43.36548],
  ["Praça Onze", -22.90992, -43.20028],
  ["Saara", -22.90329, -43.1862],
  ["Saens Peña", -22.92417, -43.23257],
  ["Siqueira Campos", -22.96731, -43.18734],
  ["São Conrado", -22.99123, -43.25503],
  ["São Cristóvão", -22.90969, -43.22099],
  ["São Francisco Xavier", -22.92058, -43.22367],
  ["Thomáz Coelho", -22.8626, -43.30679],
  ["Triagem", -22.89685, -43.24448],
  ["Uruguai", -22.93093, -43.23829],
  ["Uruguaiana", -22.90289, -43.1818],
  ["Vicente de Carvalho", -22.85404, -43.31315],
];

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearestStation(lat: number, lng: number): { name: string; meters: number } {
  let best = { name: STATIONS[0]![0], meters: Infinity };
  for (const [name, sLat, sLng] of STATIONS) {
    const m = haversine(lat, lng, sLat, sLng);
    if (m < best.meters) best = { name, meters: m };
  }
  return best;
}

export const fmtDist = (m: number): string =>
  m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
