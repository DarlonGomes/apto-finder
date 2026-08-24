// The signature element (PRD 9.2): one horizontal rule split proportionally
// into rent / condo / IPTU / other, hatched segment when pricing is incomplete.
// A labeled legend below the bar says what each color is and how much.

import type { UnitCard } from "@apto/shared";
import { brl } from "./api";

const HATCH =
  "repeating-linear-gradient(45deg, #E2E2DC, #E2E2DC 3px, #FAFAF7 3px, #FAFAF7 6px)";

const SEGMENTS: { key: "rent" | "condo" | "iptu" | "other"; color: string; label: string }[] = [
  { key: "rent", color: "#14181C", label: "aluguel" },
  { key: "condo", color: "#6B7280", label: "condomínio" },
  { key: "iptu", color: "#A8ADB5", label: "IPTU" },
  { key: "other", color: "#CDD1D6", label: "outros" },
];

export function CostBar({ cheapest }: { cheapest: UnitCard["cheapest"] }) {
  const parts = {
    rent: cheapest.rent_cents,
    condo: cheapest.condo_cents ?? 0,
    iptu: cheapest.iptu_monthly_cents ?? 0,
    other: (cheapest.insurance_cents ?? 0) + (cheapest.service_fee_cents ?? 0),
  };
  const known = parts.rent + parts.condo + parts.iptu + parts.other;
  const incomplete = cheapest.cost_confidence !== "complete";
  // Unknown condo gets a visible hatched slice instead of pretending it's zero.
  const unknownShare = incomplete ? 0.18 : 0;
  const visible = SEGMENTS.filter((s) => parts[s.key] > 0);

  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-sm">
        {visible.map((s) => (
          <div
            key={s.key}
            style={{
              width: `${(100 * (1 - unknownShare) * parts[s.key]) / known}%`,
              background: s.color,
            }}
          />
        ))}
        {incomplete && <div style={{ width: `${100 * unknownShare}%`, background: HATCH }} />}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-4 text-muted">
        {visible.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: s.color }}
            />
            {s.label} <span className="tabular">{brl(parts[s.key])}</span>
          </span>
        ))}
        {incomplete && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: HATCH }} />
            condomínio ?
          </span>
        )}
      </div>
    </div>
  );
}
