import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyElder, validateElder, splitList, renumber, toProfile, uiLang } from "./profile.ts";

const ok = () => ({ ...emptyElder("e1"), display_name: "Test Elder 1", gds_stage: 4 as const });

test("a named elder with a chosen stage is valid", () => {
  assert.deepEqual(validateElder(ok(), true), []);
});

test("name and an explicit stage choice are required; 'not assessed' (null) is allowed when chosen", () => {
  assert.deepEqual(validateElder({ ...ok(), display_name: "  " }, true), ["display_name"]);
  assert.deepEqual(validateElder({ ...ok(), gds_stage: null }, false), ["gds_stage"]);
  assert.deepEqual(validateElder({ ...ok(), gds_stage: null }, true), []);
});

test("age, birth decade, sundowning window, phones and helpline are checked", () => {
  const e = {
    ...ok(),
    age: 30,
    birth_decade: 1945,
    sundown_start: "17:00",
    sundown_end: null,
    family_contacts: [{ name: "Test Son", phone: "12", order: 1 }],
    ngo_helpline: "x",
  };
  assert.deepEqual(validateElder(e, true), ["age", "birth_decade", "sundown", "contact_phone", "ngo_helpline"]);
  assert.deepEqual(validateElder({ ...ok(), sundown_start: "17:00", sundown_end: "20:30", birth_decade: 1950 }, true), []);
});

test("splitList trims, drops blanks and duplicates", () => {
  assert.deepEqual(splitList("bhajan, Bhajan,\n gardening ,, "), ["bhajan", "gardening"]);
});

test("renumber sets call order from list position", () => {
  assert.deepEqual(renumber([{ name: "B", phone: "1", order: 5 }, { name: "A", phone: "2", order: 1 }]).map((c) => c.order), [1, 2]);
});

test("toProfile maps the stored row to the companion profile without inventing values", () => {
  const p = toProfile({ ...ok(), dialect: "Bundeli", triggers: ["hospital"] });
  assert.equal(p.displayName, "Test Elder 1");
  assert.equal(p.gdsStage, 4);
  assert.equal(p.dialect, "Bundeli");
  assert.deepEqual(p.triggers, ["hospital"]);
  assert.equal(p.age, null);
  assert.equal(p.personaName, "Sahaya");
});

test("uiLang: English only for en-*, Hindi otherwise", () => {
  assert.equal(uiLang("en-IN"), "en");
  assert.equal(uiLang("mr-IN"), "hi");
  assert.equal(uiLang(null), "hi");
});
