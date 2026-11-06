// Shared shapes between collector, worker, and web.
// Money is always monthly BRL integer cents. Never floats.

export type Source = "vivareal" | "zap" | "olx" | "quintoandar";
export type CostConfidence = "complete" | "partial";
export type UnitStatus = "liked" | "visit_booked" | "proposal_made" | "dismissed";
export type Furnished = "none" | "partial" | "full";
export type PetsEvidence = "amenity" | "description";

/** Output of every per-source adapter. One shape, whatever the portal. */
export interface NormalizedListing {
  source: Source;
  sourceListingId: string;
  url: string;

  rentCents: number;
  condoCents: number | null;
  iptuMonthlyCents: number | null;
  insuranceCents: number | null;
  serviceFeeCents: number | null;
  costConfidence: CostConfidence;

  bedrooms: number | null;
  suites: number | null;
  bathrooms: number | null;
  parkingSpots: number | null;
  areaM2: number | null;
  floor: number | null;

  neighborhood: string | null;
  street: string | null;
  lat: number | null;
  lng: number | null;

  acceptsPets: boolean | null; // null = unknown, and that matters
  petsEvidence: PetsEvidence | null;
  furnished: Furnished | null;

  photoUrls: string[];
  advertiser: string | null;

  raw: unknown;
}

/** A unit as returned by GET /api/units. */
export interface UnitCard {
  id: string;
  neighborhood: string;
  street: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_m2: number | null;
  lat: number | null;
  lng: number | null;
  parking_spots: number | null;
  accepts_pets: boolean | null;
  pets_evidence: PetsEvidence | null;
  cheapest: {
    total_monthly_cents: number;
    rent_cents: number;
    condo_cents: number | null;
    iptu_monthly_cents: number | null;
    insurance_cents: number | null;
    service_fee_cents: number | null;
    cost_confidence: CostConfidence;
    source: Source;
    url: string;
  };
  listing_count: number;
  /** Every active offer for the unit, cheapest first. */
  links: { source: Source; url: string; total_monthly_cents: number }[];
  price_spread_cents: number;
  days_listed: number;
  price_change_pct: number | null;
  thumbnail: string | null;
  status: UnitStatus | null;
  status_actor: string | null; // Access email of whoever set the current status
  status_visit_at: string | null; // visit_booked: scheduled date/time (ISO)
  status_amount_cents: number | null; // proposal_made: offer in integer BRL cents
  status_note: string | null; // proposal_made: optional context
  liked_by: string[]; // every actor who ever liked the unit (compare view)
  note: string | null; // shared per-unit note from unit_notes
  delisted_at: string | null; // set when every listing is off the market (liked+ units only)
  last_change: { at: string; from_cents: number } | null; // most recent price change of the cheapest listing
}

/** Extra payload for PUT /api/units/:id/status, per status. */
export interface StatusExtra {
  visit_at?: string | null;
  amount_cents?: number | null;
  note?: string | null;
}

export interface UnitsResponse {
  units: UnitCard[];
  next_cursor: string | null;
  total_matching: number;
}

// ---- Accounts and searches ------------------------------------------------

/** Rio bairros offered in the search picklist. Spelling matches Glue's taxonomy
 *  (accents matter: "Grajau" returns nothing). Largo do Machado is QuintoAndar-only. */
export const RIO_NEIGHBORHOODS = [
  // Zona Sul
  "Botafogo", "Catete", "Copacabana", "Cosme Velho", "Flamengo", "Gávea", "Glória",
  "Humaitá", "Ipanema", "Jardim Botânico", "Lagoa", "Laranjeiras", "Largo do Machado",
  "Leblon", "Leme", "São Conrado", "Urca",
  // Centro
  "Centro", "Lapa", "Santa Teresa", "Santo Cristo", "Gamboa", "Saúde",
  // Zona Norte
  "Andaraí", "Grajaú", "Maracanã", "Praça da Bandeira", "Tijuca", "Vila Isabel",
  "São Cristóvão", "Méier", "Engenho Novo", "Lins de Vasconcelos", "Cachambi",
  "Todos os Santos", "Del Castilho", "Pilares", "Penha", "Olaria", "Ramos",
  "Ilha do Governador", "Jardim Guanabara", "Freguesia (Ilha do Governador)",
  "Vila da Penha", "Vista Alegre", "Irajá", "Madureira",
  // Zona Oeste
  "Barra da Tijuca", "Recreio dos Bandeirantes", "Jacarepaguá",
  "Freguesia (Jacarepaguá)", "Pechincha", "Taquara", "Anil", "Itanhangá",
  "Joá", "Vargem Grande", "Vargem Pequena", "Camorim", "Curicica",
  "Campo Grande", "Bangu", "Realengo",
] as const;

/** Building/unit facilities a search can require, mapped to each source's
 *  amenity codes (Glue `listing.amenities`, QuintoAndar `amenities`). A unit
 *  matches when its cheapest listing carries any of the codes. */
export const FACILITIES: Record<string, { label: string; codes: string[] }> = {
  elevator: { label: "Elevador", codes: ["ELEVATOR", "ELEVADOR"] },
  concierge: { label: "Portaria 24h", codes: ["CONCIERGE_24H", "WATCHMAN", "PORTARIA_24H"] },
  pool: { label: "Piscina", codes: ["POOL", "ADULT_POOL", "PISCINA"] },
  gym: { label: "Academia", codes: ["GYM", "FITNESS_ROOM", "ACADEMIA"] },
  party_hall: { label: "Salão de festas", codes: ["PARTY_HALL", "SALAO_DE_FESTAS"] },
  playground: { label: "Playground", codes: ["PLAYGROUND"] },
  bbq: { label: "Churrasqueira", codes: ["BARBECUE_GRILL", "CHURRASQUEIRA"] },
  balcony: { label: "Varanda", codes: ["BALCONY", "VARANDA", "VARANDA_GOURMET"] },
  air_conditioning: { label: "Ar-condicionado", codes: ["AIR_CONDITIONING", "AR_CONDICIONADO"] },
  gated: { label: "Condomínio fechado", codes: ["GATED_COMMUNITY"] },
};

export interface Search {
  id: string;
  name: string;
  city: string;
  neighborhoods: string[];
  total_min_cents: number | null;
  total_max_cents: number | null;
  bedrooms_min: number | null;
  bathrooms_min: number | null;
  parking_min: number | null;
  /** required = confirmed pet-friendly only; unknown_ok = drop explicit "no"; any = ignore */
  pets: "required" | "unknown_ok" | "any";
  furnished: "any" | "yes" | "no";
  facilities: string[];
  members: { email: string; first_name: string | null }[];
}

export type SearchInput = Omit<Search, "id" | "city" | "members">;

export interface Me {
  email: string;
  first_name: string | null;
  last_name: string | null;
  home_neighborhood: string | null;
  home_city: string | null;
  referral: string | null;
  searches: Search[];
}

export const MAX_NEIGHBORHOODS = 15;

const optInt = (v: unknown, max: number): number | null | undefined =>
  v == null || v === "" ? null : Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : undefined;

/** Trust-boundary check for search criteria from the client. Returns the
 *  cleaned input or an error message (Portuguese, shown as-is in the UI). */
export function validateSearch(b: any): SearchInput | string {
  if (!b || typeof b !== "object") return "dados inválidos";
  const hoods: string[] = Array.isArray(b.neighborhoods) ? [...new Set(b.neighborhoods as string[])] : [];
  if (hoods.length === 0) return "escolha ao menos um bairro";
  // ponytail: per-search cap only; the collector sweeps the union of every
  // search, so many accounts can still widen it. Gate signups if that happens.
  if (hoods.length > MAX_NEIGHBORHOODS) return `escolha no máximo ${MAX_NEIGHBORHOODS} bairros`;
  if (!hoods.every((h) => (RIO_NEIGHBORHOODS as readonly string[]).includes(h))) return "bairro desconhecido";
  const min = optInt(b.total_min_cents, 100_000_000);
  const max = optInt(b.total_max_cents, 100_000_000);
  const beds = optInt(b.bedrooms_min, 10);
  const baths = optInt(b.bathrooms_min, 10);
  const parking = optInt(b.parking_min, 10);
  if ([min, max, beds, baths, parking].includes(undefined)) return "número inválido";
  if (min != null && max != null && min > max) return "valor mínimo maior que o máximo";
  const pets = b.pets ?? "any";
  if (!["required", "unknown_ok", "any"].includes(pets)) return "opção de pets inválida";
  const furnished = b.furnished ?? "any";
  if (!["any", "yes", "no"].includes(furnished)) return "opção de mobília inválida";
  const facilities: string[] = Array.isArray(b.facilities) ? [...new Set(b.facilities as string[])] : [];
  if (!facilities.every((f) => Object.hasOwn(FACILITIES, f))) return "comodidade desconhecida";
  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 60) : "Minha busca";
  return {
    name, neighborhoods: hoods,
    total_min_cents: min!, total_max_cents: max!,
    bedrooms_min: beds!, bathrooms_min: baths!, parking_min: parking!,
    pets, furnished, facilities,
  };
}

/** Lowercased, trimmed email or null when it doesn't look like one. */
export const normEmail = (v: unknown): string | null => {
  const e = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
};
