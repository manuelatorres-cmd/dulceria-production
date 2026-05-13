"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/dulceria";
import { usePeople, savePerson } from "@/lib/hooks";

/**
 * Skills management — per-person skill assignments.
 *
 * Skills exist as free-text strings on person.skills[]. This page
 * curates the master list (union of every skill currently assigned
 * anywhere, plus the default seven) and lets Manuela toggle them per
 * person in one grid.
 *
 * Matches the design spec: settings → skills list with add/edit/
 * archive, per-person checkbox matrix.
 */

const DEFAULT_SKILLS = [
  "tempering",
  "shelling",
  "decoration",
  "filling-cook",
  "packing",
  "teaching",
  "cleaning",
  "shop-counter",
];

export default function SkillsPage() {
  const people = usePeople(true);
  const [draft, setDraft] = useState("");

  // Union of default + assigned skills.
  const masterSkills = useMemo(() => {
    const set = new Set<string>(DEFAULT_SKILLS);
    for (const p of people) {
      for (const s of p.skills ?? []) set.add(s);
    }
    return Array.from(set).sort();
  }, [people]);

  async function addSkill() {
    const name = draft.trim().toLowerCase().replace(/\s+/g, "-");
    if (!name) return;
    // Add to first person as a seeder, so the skill shows in the master
    // list. If nobody has it, it would disappear from the list. Cleanest
    // path without a dedicated skills table.
    const first = people.find((p) => !p.archived);
    if (first && !(first.skills ?? []).includes(name)) {
      await savePerson({
        ...first,
        skills: [...(first.skills ?? []), name],
      });
    }
    setDraft("");
  }

  async function toggleSkill(personId: string, skill: string) {
    const p = people.find((x) => x.id === personId);
    if (!p) return;
    const has = (p.skills ?? []).includes(skill);
    await savePerson({
      ...p,
      skills: has
        ? (p.skills ?? []).filter((s) => s !== skill)
        : [...(p.skills ?? []), skill],
    });
  }

  async function toggleAdmin(personId: string) {
    const p = people.find((x) => x.id === personId);
    if (!p) return;
    await savePerson({ ...p, isAdmin: !p.isAdmin });
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader title="Skills" meta={"Settings" + " · " + "Tag each person with the skills they're trained on. The brain uses these to gate step assignment + labor-cost math."} />

      <section
        className="border border-border bg-card p-4 mb-5"
        style={{ borderRadius: 4 }}
      >
        <h3
          className="text-[13px] mb-2"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.012em",
          }}
        >
          Add new skill
        </h3>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="e.g. chocolate-painting, label-printing"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSkill()}
            style={{ maxWidth: 320 }}
          />
          <button type="button" onClick={addSkill} className="btn-primary">
            Add
          </button>
        </div>
      </section>

      <section
        className="border border-border bg-card p-4"
        style={{ borderRadius: 4 }}
      >
        <h3
          className="text-[13px] mb-3"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.012em",
          }}
        >
          Assignments
        </h3>
        {people.length === 0 ? (
          <p
            className="text-muted-foreground italic text-[12.5px]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            No people configured yet. Add them from /settings → People first.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr>
                  <th
                    className="sticky left-0 bg-card text-left py-2 pr-4 text-[10px] uppercase text-muted-foreground font-medium"
                    style={{ letterSpacing: "0.1em" }}
                  >
                    Person
                  </th>
                  <th
                    className="text-center py-2 px-2 text-[10px] uppercase text-muted-foreground font-medium"
                    style={{ letterSpacing: "0.1em" }}
                  >
                    Admin
                  </th>
                  {masterSkills.map((skill) => (
                    <th
                      key={skill}
                      className="text-center py-2 px-2 text-[10px] uppercase text-muted-foreground font-medium"
                      style={{ letterSpacing: "0.1em" }}
                    >
                      {skill}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <tr key={p.id} className="border-t border-border/60">
                      <td
                        className="sticky left-0 bg-card py-2 pr-4"
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontWeight: 500,
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {p.name}
                      </td>
                      <td className="text-center py-2 px-2">
                        <input
                          type="checkbox"
                          checked={p.isAdmin ?? false}
                          onChange={() => p.id && toggleAdmin(p.id)}
                        />
                      </td>
                      {masterSkills.map((skill) => {
                        const has = (p.skills ?? []).includes(skill);
                        return (
                          <td
                            key={skill}
                            className="text-center py-2 px-2"
                          >
                            <input
                              type="checkbox"
                              checked={has}
                              onChange={() => p.id && toggleSkill(p.id, skill)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
