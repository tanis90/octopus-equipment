import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEquipmentPack, createDocuments, loadSources, PACK_ROOT } from "./build.mjs";

const first = buildEquipmentPack();
const second = buildEquipmentPack();
assert.deepEqual(Buffer.from(first.bytes), Buffer.from(second.bytes));
assert.deepEqual(first.documents, second.documents);
assert.equal(first.fileName, "octopus-equipment-0.1.0.zip");
assert.deepEqual(first.counts, { "coc-weapons": 36, "coc-weapon-skills": 2, "coc-armour": 5 });
assert.equal(first.bytes.length > 100_000, true);
assert.equal(first.bytes[0], 0x50);
assert.equal(first.bytes[1], 0x4b);

const sources = loadSources();
const documents = createDocuments(sources);
const allDocs = Object.values(documents).flat();
assert.equal(allDocs.length, 43);
assert.equal(new Set(allDocs.map((doc) => doc._id)).size, 43);
assert.equal(new Set(allDocs.map((doc) => doc.flags.brp.brpidFlag.id)).size, 43);
for (const doc of allDocs) {
  assert.match(doc._id, /^[A-Za-z0-9]{16}$/);
  assert.ok(doc.img.startsWith("modules/octopus-equipment/icons/"));
  assert.ok(existsSync(join(PACK_ROOT, doc.img.replace("modules/octopus-equipment/", ""))), doc.img);
}
const iconPaths = new Set(Object.values(sources.icons));
assert.equal(iconPaths.size, 27);
for (const path of iconPaths) assert.ok(existsSync(join(PACK_ROOT, "icons", path)), path);

const attribution = readFileSync(join(PACK_ROOT, "ATTRIBUTION.md"), "utf8");
for (const path of iconPaths) assert.ok(attribution.includes(`icons/${path}`), path);
assert.ok(readFileSync(join(PACK_ROOT, "LICENSE-game-icons.html"), "utf8").includes("Creative Commons"));
console.log(`octopus-equipment: PASS · 43 docs · 27 icons · ${first.bytes.length} bytes · deterministic ZIP`);
