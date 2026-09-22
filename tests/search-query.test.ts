import assert from "node:assert/strict";
import { test } from "node:test";
import { namePattern, quotedStockNames, stockNames } from "../lib/stock-search";
import { socialQuery, socialSearchLinks } from "../lib/social-links";
import { reportDate, reportPage } from "../lib/report-query";

test("stock names share normalization across news and social searches without empty or repeated phrases", () => {
  const stock = {
    symbol: "NHY.OL",
    name: " Norsk  Hydro ",
    aliases: ["Hydro", " hydro ", "", '"()\\'],
  };
  assert.deepEqual(stockNames(stock).slice(0, 2), ["Norsk Hydro", "Hydro"]);
  assert.deepEqual(quotedStockNames(stock), ['"Norsk Hydro"', '"Hydro"']);
  const query = socialQuery(stock);
  assert.equal(query, '"Norsk Hydro" OR "Hydro" OR "NHY.OL" OR $NHY');
  for (const link of Object.values(socialSearchLinks(stock)))
    assert.equal(new URL(link).searchParams.get("q"), query);
});

test("company matching respects Unicode word boundaries, special characters, whitespace and empty aliases", () => {
  const pattern = namePattern(["Subsea 7", "A+B", "Ørsted", "Hydro", ""]);
  for (const title of [
    "subsea7 kontrakt",
    "Subsea  7 kontrakt",
    "A+B: ordre",
    "ØRSTED vokser",
    "Hydro med resultat",
  ])
    assert.equal(pattern.test(title), true, title);
  for (const title of [
    "Subsea 70",
    "AAB",
    "Hydrogen",
    "Ørstedene",
    "Et annet selskap",
  ])
    assert.equal(pattern.test(title), false, title);
  assert.equal(namePattern(["", " "]).test("Vil aldri treffe"), false);
});

test("archive dates require a real calendar date and a single query value", () => {
  for (const value of ["2026-09-22", "2024-02-29", "2026-12-31"])
    assert.equal(reportDate(value), value);
  for (const value of [
    undefined,
    ["2026-09-22"],
    ["2026-09-21", "2026-09-22"],
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "0000-01-01",
    "2026-9-22",
    "garbage",
  ])
    assert.equal(reportDate(value), undefined);
});

test("Reddit page parsing rejects arrays, fractions, exponent notation and unsafe numbers", () => {
  assert.equal(reportPage("2"), 2);
  for (const value of [
    undefined,
    ["2", "3"],
    "0",
    "-2",
    "2.5",
    "1e3",
    "Infinity",
    "9007199254740992",
  ])
    assert.equal(reportPage(value), 1);
});
