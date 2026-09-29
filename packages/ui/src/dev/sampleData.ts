/**
 * Deterministic sample CRM table that exercises every UX path: an ID column,
 * free text, missing values, dates, a learnable Yes/No target, and 12 new
 * leads with no outcome yet.
 */
export function sampleLeads(rows = 240, newLeads = 12): unknown[][] {
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;

  const industries = ["SaaS", "Retail", "Manufacturing", "Healthcare", "Finance"] as const;
  const sources = ["Referral", "Organic", "Event", "Paid"] as const;
  const regions = ["North America", "Europe", "APAC"] as const;
  const people = ["Dana", "Priya", "Marco", "Keiko", "Sam", "Olu", "Ines", "Tom"];
  const topics = ["pricing for the team plan", "SSO and audit logs", "a Q3 pilot", "renewal timing", "the API limits", "a security review"];
  const note = (d: string) =>
    rand() < 0.45 ? "" : `Call with ${pick(people)} on ${d} about ${pick(topics)}; ${Math.round(rand() * 40) + 2} seats discussed.`;
  const names = ["Acme", "Globex", "Initech", "Umbrella", "Hooli", "Stark", "Wayne", "Tyrell", "Soylent", "Wonka", "Cyberdyne", "Aperture"];

  const out: unknown[][] = [
    ["Lead ID", "Company", "Industry", "Region", "Employees", "Lead Source", "Annual Revenue", "Signup Date", "Notes", "Closed Won"],
  ];
  for (let i = 0; i < rows + newLeads; i++) {
    const industry = pick(industries);
    const source = pick(sources);
    const employees = Math.round(10 * Math.exp(rand() * 5.5));
    const revenue = rand() < 0.04 ? "" : Math.round(employees * (60_000 + rand() * 90_000) / 1000) * 1000;
    const day = new Date(Date.UTC(2025, 0, 1) + Math.floor(rand() * 540) * 86_400_000);
    const score =
      { Referral: 1.4, Event: 0.6, Organic: 0.1, Paid: -0.9 }[source] +
      { SaaS: 0.6, Finance: 0.3, Healthcare: 0, Retail: -0.4, Manufacturing: -0.3 }[industry] +
      (Math.log10(employees) - 2) * 0.8 +
      (rand() - 0.5) * 1.6;
    const won = i >= rows ? "" : score > 0.55 ? "Yes" : "No";
    out.push([
      `L-${1001 + i}`,
      `${pick(names)} ${pick(["Labs", "Corp", "Group", "Systems", "Co"])} ${i + 1}`,
      industry,
      pick(regions),
      employees,
      source,
      revenue,
      day.toISOString().slice(0, 10),
      note(day.toISOString().slice(0, 10)),
      won,
    ]);
  }
  return out;
}
