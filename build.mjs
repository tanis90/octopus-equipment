import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeWal, makeWriteBatch, makeZip } from "./lib/fvtt-module-writer.mjs";
import { parseFormula } from "./lib/coc-dice.mjs";

export const PACK_ROOT = dirname(fileURLToPath(import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(join(PACK_ROOT, path), "utf8"));
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BRPID_RE = /^i\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

function docId(seed) {
  let out = "";
  for (let index = 0; out.length < 16; index += 1) {
    const byte = createHash("sha256").update(`coc-common-equipment:${seed}:${index}`).digest()[0];
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function validateSources({ weapons, skills, armour, icons }) {
  const errors = [];
  const slugs = new Set();
  const names = new Set();
  const brpids = new Set();
  for (const [kind, entries] of Object.entries({ weapons, skills, armour })) {
    for (const entry of entries) {
      const where = `${kind}/${entry.slug ?? "?"}`;
      assert(SLUG_RE.test(entry.slug ?? ""), `${where}: slug 非法`, errors);
      assert(!slugs.has(entry.slug), `${where}: slug 重复`, errors);
      assert(entry.name && entry.enName, `${where}: 缺少中英文名称`, errors);
      assert(!names.has(entry.name), `${where}: 中文名重复 ${entry.name}`, errors);
      assert(Array.isArray(entry.sourceRefs) || kind === "weapons", `${where}: 缺少来源`, errors);
      assert(typeof icons[entry.slug] === "string", `${where}: 缺少图标映射`, errors);
      slugs.add(entry.slug);
      names.add(entry.name);
      const brpid = entry.brpid ?? `i.${kind === "armour" ? "armour" : kind === "skills" ? "skill" : "weapon"}.coc.${entry.slug}`;
      assert(BRPID_RE.test(brpid), `${where}: brpid 非法 ${brpid}`, errors);
      assert(!brpids.has(brpid), `${where}: brpid 重复 ${brpid}`, errors);
      brpids.add(brpid);
    }
  }
  for (const path of new Set(Object.values(icons))) {
    assert(existsSync(join(PACK_ROOT, "icons", path)), `图标文件缺席：${path}`, errors);
  }
  for (const entry of weapons) {
    const where = `weapon/${entry.slug}`;
    assert(["melee", "missile", "firearm"].includes(entry.weaponType), `${where}: weaponType 非法`, errors);
    assert(entry.skill1?.startsWith("i.skill.coc."), `${where}: skill1 必须是 CoC brpid`, errors);
    assert(Array.isArray(entry.damage) && entry.damage.length >= 1 && entry.damage.length <= 3, `${where}: 需要一至三段伤害`, errors);
    for (const formula of entry.damage ?? []) {
      try { parseFormula(formula); } catch { errors.push(`${where}: 伤害公式非法 ${formula}`); }
    }
    const ranges = entry.ranges ?? ["S"];
    assert(ranges.length === entry.damage?.length, `${where}: 伤害与射程段数不一致`, errors);
    assert(["full", "half", "none"].includes(entry.db), `${where}: DB 档非法`, errors);
    assert(["none", "impale"].includes(entry.special), `${where}: special 非法`, errors);
    assert(Number.isInteger(entry.att) && entry.att >= 1, `${where}: att 非法`, errors);
    assert(entry.attacksText, `${where}: 缺少攻击次数原文`, errors);
    assert(Number.isInteger(entry.mal ?? 0) && (entry.mal ?? 0) >= 0 && (entry.mal ?? 0) <= 100, `${where}: 故障值非法`, errors);
    assert(Number.isInteger(entry.ammo ?? 0) && (entry.ammo ?? 0) >= 0, `${where}: 弹容量非法`, errors);
    assert(entry.cost === null || (Number.isFinite(entry.cost) && entry.cost >= 0), `${where}: 价格非法`, errors);
  }
  for (const entry of skills) {
    const where = `skill/${entry.slug}`;
    assert(Number.isInteger(entry.base) && entry.base >= 0 && entry.base <= 100, `${where}: 基础值非法`, errors);
    assert(entry.parentKey === "firearms", `${where}: 本包只允许射击专精`, errors);
    assert(SLUG_RE.test(entry.specKey ?? ""), `${where}: specKey 非法`, errors);
  }
  for (const entry of armour) {
    const where = `armour/${entry.slug}`;
    assert(Number.isInteger(entry.av1) && entry.av1 > 0, `${where}: 护甲值非法`, errors);
    assert(entry.coverage, `${where}: 缺少防护部位`, errors);
  }
  if (errors.length) throw new Error(`装备数据校验失败 ${errors.length} 条：\n${errors.map((error) => `- ${error}`).join("\n")}`);
}

function commonFlags(entry, type) {
  const brpid = entry.brpid ?? `i.${type}.coc.${entry.slug}`;
  return {
    brp: {
      brpidFlag: { id: brpid, lang: "zh-CN", priority: 1 },
      enName: entry.enName,
      contentSource: "coc",
      coc: {
        factId: `coc7-equipment.${entry.slug}`,
        key: entry.slug,
        parentKey: entry.parentKey ?? null,
        specKey: entry.specKey ?? null,
        sourceRefs: entry.sourceRefs ?? ["coc7-official-weapons"],
      },
      cocEquipment: {
        attacksText: entry.attacksText ?? null,
        ammoOptions: entry.ammoOptions ?? null,
      },
    },
  };
}

// FVTT CoC / BRP 原生 Item.weapon 的 properties 全键（顺序照 template.json）。
const WEAPON_PROPERTY_KEYS = Object.freeze([
  "rngd", "mnvr", "thrown", "shotgun", "dbrl", "impl", "brst", "auto", "ahdb", "addb",
  "slnt", "spcl", "mont", "blst", "stun", "rare", "burn",
]);

// 扁形事实源 → 原生嵌套。规则层 weaponProfile 只读嵌套（properties.impl/rngd/thrown/
// addb/ahdb、range.*、usesPerRound.normal、malfunction），扁形字段一律只作镜像留给旧卡面。
function weaponProperties(entry) {
  const base = Object.fromEntries(WEAPON_PROPERTY_KEYS.map((key) => [key, false]));
  return {
    ...base,
    // 火器 = 远程；投掷类（missile）按原生 thrown 归到 missile 种类，DB 半档。
    rngd: entry.weaponType === "firearm",
    thrown: entry.weaponType === "missile",
    impl: entry.special === "impale",
    ahdb: entry.db === "half",
    addb: entry.db === "full",
    // burning-torch 的「着火」在原生形状里是 burn 属性（CoC 卡面 properties.burn）。
    burn: entry.fire === true,
  };
}

function weaponRange(entry) {
  const ranges = entry.ranges ?? ["S"];
  const bands = ["normal", "long", "extreme"];
  const out = {};
  for (const [index, band] of bands.entries()) {
    out[band] = {
      value: String(ranges[index] ?? ""),
      damage: String(entry.damage[index] ?? ""),
    };
  }
  return out;
}

function weaponDoc(entry, manifest, icons) {
  const ranges = entry.ranges ?? ["S"];
  const ammo = entry.ammo ?? 0;
  return {
    _id: docId(`weapon-${entry.slug}`),
    name: entry.name,
    type: "weapon",
    img: `modules/${manifest.id}/icons/${icons[entry.slug]}`,
    flags: commonFlags(entry, "weapon"),
    system: {
      // —— 原生嵌套（template.json Item.weapon；规则层与 CoC 卡面的唯一读取面）——
      range: weaponRange(entry),
      // 原生 skill.main/alternativ 存角色身上技能 Item 的 id/name，包内无法预知，保持空；
      // 命中技能的身份仍由下面的 skill1/skill2 brpid 承载（check.mjs weaponSkill()）。
      skill: {
        main: { name: "", id: "" },
        alternativ: { name: "", id: "" },
      },
      description: {
        value: entry.description,
        special: entry.special,
        keeper: "",
      },
      usesPerRound: { normal: String(entry.att), max: null, burst: null },
      bullets: ammo > 0 ? ammo : null,
      ammo,
      malfunction: entry.mal ?? 0,
      blastRadius: null,
      properties: weaponProperties(entry),
      // 价格沿用扁形选择键（旧卡面/原生武器卡读 system.price 作 i18n 键）；模板默认 {} 不采纳。
      price: "",
      // —— 扁形镜像（旧卡面 npcV2/character、旧宏与 weaponSkill 读；嵌套为准）——
      gmDescription: "",
      weaponType: entry.weaponType,
      skill1: entry.skill1,
      skill2: "none",
      dmg1: entry.damage[0],
      dmg2: entry.damage[1] ?? "",
      dmg3: entry.damage[2] ?? "",
      special: entry.special,
      db: entry.db,
      att: entry.att,
      range1: ranges[0],
      range2: ranges[1] ?? "",
      range3: ranges[2] ?? "",
      hands: entry.hands ?? "1H",
      parry: entry.weaponType === "melee",
      fire: entry.fire === true,
      ammoType: entry.ammoType ?? "",
      ammoCurr: ammo,
      mal: entry.mal ?? 0,
      rof: entry.attacksText,
      quantity: 1,
      enc: 0,
      cost: entry.cost ?? 0,
      equipStatus: "carried",
      npcVal: 0,
      hp: 0,
      hpCurr: 0,
      ap: 0,
      str: 0,
      dex: 0,
      pSCurr: 0,
      pSMax: 0,
    },
  };
}

// 构建期自检：嵌套为规则唯一读取面，镜像必须逐字段同步；任何一处漂移都直接炸构建。
function validateWeaponDocuments(documents, entries) {
  const errors = [];
  const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));
  for (const doc of documents) {
    const system = doc.system;
    const where = `weapon/${doc.flags?.brp?.coc?.key ?? doc.name}`;
    const entry = bySlug.get(doc.flags?.brp?.coc?.key);
    assert(entry, `${where}: 源条目缺席（slug 不一致）`, errors);
    if (entry) {
      assert(system.description.value === entry.description, `${where}: description.value 与源描述不一致`, errors);
      assert(system.skill1 === entry.skill1, `${where}: skill1 与源条目不一致`, errors);
      assert(system.weaponType === entry.weaponType, `${where}: weaponType 与源条目不一致`, errors);
    }
    assert(system.range && system.properties && system.usesPerRound, `${where}: 缺原生嵌套块`, errors);
    assert(system.properties.impl === (system.special === "impale"), `${where}: impl 与 special 不一致`, errors);
    assert(system.properties.rngd === (system.weaponType === "firearm"), `${where}: rngd 与 weaponType 不一致`, errors);
    assert(system.properties.thrown === (system.weaponType === "missile"), `${where}: thrown 与 weaponType 不一致`, errors);
    assert(system.properties.addb === (system.db === "full"), `${where}: addb 与 db 不一致`, errors);
    assert(system.properties.ahdb === (system.db === "half"), `${where}: ahdb 与 db 不一致`, errors);
    assert(!(system.properties.addb === true && system.properties.ahdb === true), `${where}: addb/ahdb 同时生效`, errors);
    for (const [index, band] of ["normal", "long", "extreme"].entries()) {
      assert(system.range[band].damage === [system.dmg1, system.dmg2, system.dmg3][index], `${where}: range.${band}.damage 镜像漂移`, errors);
      assert(system.range[band].value === [system.range1, system.range2, system.range3][index], `${where}: range.${band}.value 镜像漂移`, errors);
    }
    assert(String(system.usesPerRound.normal) === String(system.att), `${where}: usesPerRound 镜像漂移`, errors);
    assert(system.malfunction === system.mal, `${where}: malfunction 镜像漂移`, errors);
    assert(system.description.special === system.special, `${where}: description.special 镜像漂移`, errors);
    assert(String(system.skill1).startsWith("i.skill.coc."), `${where}: skill1 不是 CoC brpid`, errors);
    assert(system.skill2 === "none", `${where}: skill2 应为 none`, errors);
    assert(doc.flags?.brp?.coc?.weapon === undefined, `${where}: 不应写 flags.brp.coc.weapon marker`, errors);
    if (system.bullets !== null) assert(system.bullets === system.ammoCurr, `${where}: bullets 镜像漂移`, errors);
    if (system.weaponType === "firearm") assert(system.malfunction > 0, `${where}: 火器 malfunction 为 0`, errors);
  }
  if (errors.length) throw new Error(`武器原生形状自检失败 ${errors.length} 条：\n${errors.map((error) => `- ${error}`).join("\n")}`);
}

function skillDoc(entry, manifest, icons) {
  return {
    _id: docId(`skill-${entry.slug}`),
    name: entry.name,
    type: "skill",
    img: `modules/${manifest.id}/icons/${icons[entry.slug]}`,
    flags: commonFlags(entry, "skill"),
    system: {
      description: entry.description,
      gmDescription: "",
      base: entry.base,
      basic: false,
      combat: true,
      category: "none",
      baseFormula: {
        1: { stat: "fixed", value: entry.base },
        2: { stat: "fixed", value: 0 },
        Func: "or",
      },
      variable: false,
      specialism: true,
      chosen: true,
      specName: entry.name,
      mainName: "射击",
      parentKey: entry.parentKey,
      specKey: entry.specKey,
      noXP: false,
      group: false,
      xp: 0,
      culture: 0,
      profession: 0,
      personality: 0,
      personal: 0,
      effects: 0,
    },
  };
}

function armourDoc(entry, manifest, icons) {
  return {
    _id: docId(`armour-${entry.slug}`),
    name: entry.name,
    type: "armour",
    img: `modules/${manifest.id}/icons/${icons[entry.slug]}`,
    flags: commonFlags(entry, "armour"),
    system: {
      description: entry.description,
      gmDescription: "",
      av1: entry.av1,
      av2: 0,
      avr1: "",
      avr2: "",
      armVar: false,
      armBal: false,
      burden: "",
      enc: 0,
      mnplmod: 0,
      percmod: 0,
      physmod: 0,
      stealthmod: 0,
      sizRng: 0,
      time: 1,
      quantity: 1,
      ppMax: 0,
      ppCurr: 0,
      price: "",
      cost: 0,
      hitlocID: "",
      equipStatus: "carried",
      HPL: false,
      coverage: entry.coverage,
      pSCurr: 0,
      pSMax: 0,
    },
  };
}

export function loadSources() {
  const manifest = readJson("module.json");
  const provenance = readJson("content/provenance.json");
  const weapons = readJson("content/weapons.json").weapons;
  const skills = readJson("content/skills.json").skills;
  const armour = readJson("content/armour.json").armour;
  const icons = readJson("content/icons.json");
  validateSources({ weapons, skills, armour, icons });
  return { manifest, provenance, weapons, skills, armour, icons };
}

export function createDocuments(sources = loadSources()) {
  const documents = {
    "coc-weapons": sources.weapons.map((entry) => weaponDoc(entry, sources.manifest, sources.icons)),
    "coc-weapon-skills": sources.skills.map((entry) => skillDoc(entry, sources.manifest, sources.icons)),
    "coc-armour": sources.armour.map((entry) => armourDoc(entry, sources.manifest, sources.icons)),
  };
  validateWeaponDocuments(documents["coc-weapons"], sources.weapons);
  return documents;
}

export function buildEquipmentPack(sources = loadSources()) {
  const documents = createDocuments(sources);
  const declared = new Set(sources.manifest.packs.map((pack) => pack.name));
  for (const name of Object.keys(documents)) {
    if (!declared.has(name)) throw new Error(`module.json 未声明包 ${name}`);
  }
  const entries = [
    ["module.json", Buffer.from(`${JSON.stringify(sources.manifest, null, 2)}\n`)],
    ["provenance.json", Buffer.from(`${JSON.stringify(sources.provenance, null, 2)}\n`)],
    ["ATTRIBUTION.md", readFileSync(join(PACK_ROOT, "ATTRIBUTION.md"))],
    ["LICENSE-game-icons.html", readFileSync(join(PACK_ROOT, "LICENSE-game-icons.html"))],
  ];
  for (const pack of sources.manifest.packs) {
    const docs = documents[pack.name] ?? [];
    if (!docs.length) throw new Error(`包 ${pack.name} 没有条目`);
    const ops = docs.map((doc) => [`!items!${doc._id}`, JSON.stringify(doc)]);
    entries.push([`${pack.path}/000001.log`, Buffer.from(makeWal([makeWriteBatch(ops, 1)]))]);
  }
  const iconPaths = [...new Set(Object.values(sources.icons))].sort();
  for (const path of iconPaths) entries.push([`icons/${path}`, readFileSync(join(PACK_ROOT, "icons", path))]);
  return {
    bytes: makeZip(entries),
    documents,
    fileName: `${sources.manifest.id}-${sources.manifest.version}.zip`,
    counts: Object.fromEntries(Object.entries(documents).map(([name, docs]) => [name, docs.length])),
  };
}

export function writeEquipmentPack() {
  const result = buildEquipmentPack();
  const outDir = join(PACK_ROOT, "dist");
  mkdirSync(outDir, { recursive: true });
  const output = join(outDir, result.fileName);
  writeFileSync(output, result.bytes);
  return { ...result, output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = writeEquipmentPack();
  console.log(`[coc-equipment] ${result.output}`);
  console.log(`[coc-equipment] ${Object.entries(result.counts).map(([name, count]) => `${name}=${count}`).join(" · ")} · ${result.bytes.length} bytes`);
}
