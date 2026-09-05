import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const owbRoot = path.join(root, ".owb-source");
const gameDir = path.join(owbRoot, "public", "games", "the-old-world");
const cardsCsv = path.join(root, "assets", "magic_cards", "all_spells.csv");
const outFile = path.join(root, "src", "main", "resources", "faction-magic-access.json");

const loreIdMap = {
  "battle-magic": "battle_magic",
  daemonology: "daemonology",
  "dark-magic": "dark_magic",
  elementalism: "elementalism",
  "high-magic": "high_magic",
  illusion: "illusion",
  necromancy: "necromancy",
  "waaagh-magic": "waaagh_magic",
  shadowlands: "lore_of_the_shadowlands",
  "lore-of-athel-loren": "athel_loren",
  "lore-of-the-horned-rat": "the_horned_rat",
  "lore-of-the-great-maw": "the_great_maw",
};

const boundItemEffects = [
  {
    itemName: "Ruby Ring of Ruin",
    sourceType: "magic-item",
    loreIds: ["battle_magic"],
    spellName: "Fireball",
    powerLevel: 1,
  },
  {
    itemName: "Ring of Doom",
    sourceType: "magic-item",
    loreIds: ["dark_magic"],
    spellName: "Doombolt",
    powerLevel: 2,
  },
  {
    itemName: "Ring of Fury*",
    sourceType: "magic-item",
    loreIds: ["battle_magic"],
    spellName: "Hammerhand",
    powerLevel: 1,
  },
  {
    itemName: "Rod of the Damned",
    sourceType: "magic-item",
    loreIds: ["daemonology"],
    spellName: "The Summoning",
    powerLevel: 2,
  },
  {
    itemName: "Alchemist's Mask",
    sourceType: "magic-item",
    loreIds: ["elementalism"],
    spellName: "Plague Of Rust",
    powerLevel: 1,
  },
  {
    itemName: "Ring of Jet",
    sourceType: "magic-item",
    loreIds: ["necromancy"],
    spellName: "Unquiet Spirits",
    powerLevel: 1,
  },
  {
    itemName: "Scourge of the Burdened",
    sourceType: "magic-item",
    loreIds: ["primal_magic"],
    spellName: "Call Of The Wild",
    powerLevel: 2,
  },
  {
    itemName: "Standard of Morning's Chill",
    sourceType: "magic-item",
    loreIds: ["lore_of_the_wilds"],
    spellName: "Swirling Mists",
    powerLevel: 2,
  },
];

const specialRuleBoundLores = {
  "Strike the Runes": {
    sourceType: "unit-rule",
    loreIds: ["anvil_of_doom"],
    powerLevel: 0,
  },
  "Vortex of Souls": {
    sourceType: "unit-rule",
    loreIds: ["casket_of_souls"],
    powerLevel: 0,
  },
  "Scintillating Sorcery": {
    sourceType: "unit-rule",
    loreIds: ["lore_of_daemons"],
    powerLevel: 0,
  },
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readNameMap() {
  const source = fs.readFileSync(
    path.join(owbRoot, "src", "pages", "magic", "name-map.js"),
    "utf8",
  );
  const transformed = source.replace("export const nameMap =", "module.exports =");
  const context = { module: { exports: {} } };
  vm.runInNewContext(transformed, context, { filename: "name-map.js" });
  return context.module.exports;
}

function parseCsvLine(line) {
  const result = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      result.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  result.push(value);
  return result;
}

function readSpells() {
  const lines = fs.readFileSync(cardsCsv, "utf8").trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift());
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

const gameSystem = readJson(path.join(owbRoot, "src", "assets", "the-old-world.json"));
const magicItems = readJson(path.join(gameDir, "magic-items.json"));
const loresWithSpells = readJson(
  path.join(owbRoot, "src", "assets", "lores-of-magic-with-spells.json"),
);
const nameMap = readNameMap();
const spells = readSpells();
const appLoreIds = new Set(spells.map((spell) => spell.front_image.split("/")[0]));
const spellsByName = new Map(spells.map((spell) => [spell.spell_name.toLowerCase(), spell.front_image]));

function toAppLoreId(owbLoreId) {
  return loreIdMap[owbLoreId] || owbLoreId.replaceAll("-", "_");
}

function knownAppLoreIds(owbLoreIds) {
  return [...new Set(owbLoreIds.map(toAppLoreId).filter((id) => appLoreIds.has(id)))].sort();
}

// These are replacement signature pools, not lores used for spell generation.
// Audited against tow.whfb.app; see research/army-signatures.md.
const signatureOnlyLoreIds = new Set([
  "athel_loren", "lore_of_beasts", "lore_of_chaos", "lore_of_daemons",
  "lore_of_gork", "lore_of_mork", "lore_of_hashut", "lore_of_lustria",
  "lore_of_naggaroth", "lore_of_nehekhara", "lore_of_saphery",
  "lore_of_the_lady", "lore_of_undeath", "the_great_maw", "the_horned_rat",
  "lore_of_yang", "lore_of_yin", "miao_ying",
]);

function signatureOptions(unit, armyComposition, allLores) {
  const pool = allLores.filter((id) => signatureOnlyLoreIds.has(id));
  const cards = (loreIds, god = "") => spells.filter((spell) =>
    loreIds.includes(spell.front_image.split("/")[0]) &&
    (!god || spell.spell_name.toLowerCase().includes(god.toLowerCase()))
  ).map((spell) => spell.front_image);
  if (unit.id?.includes("miao-ying")) {
    return [{id: "mastery-of-the-storm-winds", name: "Mastery of the Storm Winds (Yang + Yin)", spellIds: cards(pool)}];
  }
  return pool.flatMap((loreId) => {
    if (loreId === "lore_of_chaos") {
      const names = [];
      const visit = (entity) => {
        if (!isAvailableForComposition(entity, armyComposition)) return;
        names.push(entity.name_en || "", ...specialRuleNames(entity, armyComposition));
        childCollections(entity).forEach(({child}) => visit(child));
      };
      visit(unit);
      const gods = ["Chaos Undivided", "Nurgle", "Slaanesh", "Tzeentch"]
        .filter((god) => names.some((name) => name.includes(`Mark of ${god}`)));
      return (gods.length ? gods : ["Chaos Undivided"]).map((god) => ({
        id: stableId(loreId, god), name: `Mark of ${god}`, spellIds: cards([loreId], god),
      }));
    }
    if (loreId === "lore_of_daemons") {
      const rules = specialRuleNames(unit, armyComposition).join(", ");
      const fixedGod = ["Nurgle", "Slaanesh", "Tzeentch"].find((god) => rules.includes(`Daemon of ${god}`));
      return (fixedGod ? [fixedGod] : ["Nurgle", "Slaanesh", "Tzeentch"]).map((god) => ({
        id: stableId(loreId, god), name: `Daemon of ${god}`, spellIds: cards([loreId], god),
      }));
    }
    return [{id: loreId, name: spells.find((spell) => spell.front_image.startsWith(`${loreId}/`)).lore,
      spellIds: cards([loreId])}];
  });
}

function isAvailableForComposition(entity, armyComposition) {
  if (!entity?.armyComposition) {
    return true;
  }
  const value = entity.armyComposition;
  if (Array.isArray(value)) {
    return value.includes(armyComposition);
  }
  if (typeof value === "string") {
    return value.includes(armyComposition);
  }
  if (typeof value === "object") {
    return Boolean(value[armyComposition]);
  }
  return true;
}

function compositionOverride(entity, armyComposition) {
  return typeof entity?.armyComposition === "object" && !Array.isArray(entity.armyComposition)
    ? entity.armyComposition[armyComposition]
    : undefined;
}

function unitAvailableInComposition(unit, armyComposition) {
  if (!unit.armyComposition) {
    return true;
  }
  return Boolean(unit.armyComposition[armyComposition]);
}

function armyDataForComposition(data, armyComposition) {
  const result = {};
  for (const category of ["characters", "core", "special", "rare", "mercenaries", "allies"]) {
    result[category] = (data[category] || []).filter((unit) =>
      unitAvailableInComposition(unit, armyComposition),
    );
  }
  return result;
}

function loreIdFromRule(rule) {
  return rule
    .replace(/\s*\{renegade\}/g, "")
    .trim()
    .toLowerCase()
    .replace(/ /g, "-");
}

function specialRuleNames(entity, armyComposition) {
  const rules = compositionOverride(entity, armyComposition)?.specialRules || entity.specialRules;
  return (rules?.name_en || "")
    .split(", ")
    .map((rule) => rule.trim())
    .filter(Boolean);
}

function specialRuleLores(entity, armyComposition) {
  return specialRuleNames(entity, armyComposition)
    .filter((rule) => /^Lore of/.test(rule))
    .map(loreIdFromRule)
    .filter((lore) => loresWithSpells[lore]);
}

function optionLore(entity) {
  const name = entity?.name_en || "";
  if (/Lore of Yang/.test(name)) {
    return "lore-of-yang";
  }
  if (/Lore of Yin/.test(name)) {
    return "lore-of-yin";
  }
  if (/^Arise!, Level 1 Wizard/.test(name)) {
    return "necromancy";
  }
  return null;
}

function getRawLores(entity, armyComposition) {
  const override = compositionOverride(entity, armyComposition);
  return override?.lores || entity.lores || [];
}

function childCollections(entity) {
  return ["command", "mounts", "options", "equipment", "armor", "detachment"]
    .flatMap((key) =>
      Array.isArray(entity?.[key])
        ? entity[key].map((child) => ({ child, relation: key }))
        : [],
    );
}

function collectEntityLores(entity, armyComposition) {
  if (!entity || !isAvailableForComposition(entity, armyComposition)) {
    return [];
  }
  const own = [
    ...getRawLores(entity, armyComposition),
    ...specialRuleLores(entity, armyComposition),
    optionLore(entity),
    entity.id?.includes("miao-ying") ? "miao-ying" : null,
  ].filter(Boolean);

  const childLores = childCollections(entity).flatMap(({ child }) =>
    collectEntityLores(child, armyComposition),
  );
  return [...new Set([...own, ...childLores])].filter((lore) => loresWithSpells[lore]);
}

function findLevelOptions(entity, result = []) {
  if (!entity) {
    return result;
  }
  if (/^(Arise!, )?Level [1234] Wizard/.test(entity.name_en || "")) {
    result.push(entity);
  }
  for (const { child } of childCollections(entity)) {
    findLevelOptions(child, result);
  }
  return result;
}

function defaultWizardLevel(unit) {
  const levels = findLevelOptions(unit).map((option) => ({
    level: Number(option.name_en.match(/[1234]/)?.[0] || 0),
    active: Boolean(option.active),
  })).filter((entry) => entry.level > 0);
  const active = levels.find((entry) => entry.active);
  if (active) {
    return active.level;
  }
  if (levels.length) {
    return Math.min(...levels.map((entry) => entry.level));
  }
  if (unit.spellCount) {
    return Math.min(Math.max(Number(unit.spellCount), 1), 4);
  }
  if (unit.name_en === "Loremaster") {
    return 1;
  }
  return 1;
}

function isWizardCandidate(unit, appLores) {
  if (!appLores.length) {
    return false;
  }
  if (unit.spellCount) {
    return false;
  }
  if (unit.name_en === "Anvil of Doom" || unit.name_en === "Casket of Souls") {
    return false;
  }
  return findLevelOptions(unit).length > 0 || appLores.length > 0;
}

function stableId(...parts) {
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getAllItemsForArmy(army, unit) {
  let categories = [...(army.items || [])];
  if (unit?.magicItemsArmy) {
    categories = categories.filter((category) => category !== army.id);
    if (magicItems[unit.magicItemsArmy]) {
      categories.push(unit.magicItemsArmy);
    }
  }
  return categories
    .flatMap((category) =>
      (magicItems[category] || []).map((item) => ({ ...item, itemCategory: category })),
    )
    .filter(Boolean);
}

function itemBearerGroups(unit, armyComposition) {
  const unitGroups = (unit.items || [])
    .filter((group) => isAvailableForComposition(group, armyComposition))
    .map((group) => ({
      owner: unit.name_en,
      types: group.types || [],
      maxPoints: group.maxPoints || 0,
    }));

  const commandGroups = (unit.command || [])
    .filter((command) => isAvailableForComposition(command, armyComposition))
    .filter((command) => command.magic)
    .map((command) => ({
      owner: `${unit.name_en} > ${command.name_en}`,
      types: command.magic.types || [],
      maxPoints:
        command.magic.armyComposition?.[armyComposition]?.maxPoints ||
        command.magic.maxPoints ||
        0,
    }));

  return [...unitGroups, ...commandGroups];
}

function canTakeMagicItem(army, unit, item, armyComposition) {
  if (!isAvailableForComposition(item, armyComposition)) {
    return false;
  }
  const armyItems = getAllItemsForArmy(army, unit);
  if (!armyItems.some((candidate) => candidate.name_en === item.name_en)) {
    return false;
  }
  return itemBearerGroups(unit, armyComposition).some((group) => {
    const maxPoints = group.maxPoints || 0;
    return group.types.includes(item.type) && (!maxPoints || item.points <= maxPoints);
  });
}

function findMagicItem(name) {
  return Object.entries(magicItems)
    .flatMap(([itemCategory, items]) =>
      items.map((item) => ({ ...item, itemCategory })),
    )
    .find((item) => item.name_en === name);
}

function mergeUniqueObjects(items, keyFunction) {
  const result = new Map();
  for (const item of items) {
    const key = keyFunction(item);
    if (!result.has(key)) {
      result.set(key, item);
    } else {
      const existing = result.get(key);
      result.set(key, {
        ...existing,
        loreIds: [...new Set([...(existing.loreIds || []), ...(item.loreIds || [])])].sort(),
        ...(existing.signatureOptions ? {signatureOptions: [...new Map(
          [...existing.signatureOptions, ...item.signatureOptions].map((option) => [option.id, option])
        ).values()]} : {}),
      });
    }
  }
  return [...result.values()];
}

const report = {
  generatedAt: new Date().toISOString(),
  source: {
    oldWorldBuilder: "https://github.com/nthiebes/old-world-builder",
    marchOfChaosPdf: "Warhammer The Old World - March of Chaos Arcane Journal.pdf",
  },
  factions: [],
};

for (const army of gameSystem.armies) {
  const armyFile = path.join(gameDir, `${army.id}.json`);
  if (!fs.existsSync(armyFile)) {
    continue;
  }

  const data = readJson(armyFile);
  const casterPresets = [];
  const boundSpellSources = [];
  const mageLoreIds = new Set();
  const boundLoreIds = new Set();

  for (const armyComposition of army.armyComposition || [army.id]) {
    const unitsByCategory = armyDataForComposition(data, armyComposition);
    const units = Object.values(unitsByCategory).flat();

    for (const [category, unitsInCategory] of Object.entries(unitsByCategory)) {
      for (const unit of unitsInCategory) {
        const appLores = knownAppLoreIds(collectEntityLores(unit, armyComposition));
        const rules = specialRuleNames(unit, armyComposition);

        if (category === "characters" && isWizardCandidate(unit, appLores)) {
          const mainLores = appLores.filter((id) => !signatureOnlyLoreIds.has(id));
          mainLores.forEach((lore) => mageLoreIds.add(lore));
          appLores.forEach((lore) => boundLoreIds.add(lore));
          casterPresets.push({
            id: stableId(army.id, unit.id || unit.name_en),
            name: unit.name_en.replace(/ *\{[^)]*\}/g, ""),
            defaultLevel: defaultWizardLevel(unit),
            loreIds: mainLores,
            signatureOptions: signatureOptions(unit, armyComposition, appLores),
            maxSignatureSpells: unit.maxSignatureSpells || 1,
          });
        }

        if (unit.spellCount && appLores.length) {
          appLores.forEach((lore) => boundLoreIds.add(lore));
          boundSpellSources.push({
            id: stableId(army.id, unit.id || unit.name_en, "bound"),
            name: `${unit.name_en.replace(/ *\{[^)]*\}/g, "")} (${rules.find((rule) => /Coven|Sorcery|Sentinel/.test(rule)) || "Bound Spell"})`,
            sourceType: "unit-rule",
            loreIds: appLores,
            spellId: "",
            powerLevel: Number(unit.spellCount) || 0,
          });
        }

        for (const rule of rules) {
          const effect = specialRuleBoundLores[rule];
          if (effect) {
            effect.loreIds.forEach((lore) => boundLoreIds.add(lore));
            boundSpellSources.push({
              id: stableId(army.id, unit.id || unit.name_en, rule),
              name: `${unit.name_en.replace(/ *\{[^)]*\}/g, "")} (${rule})`,
              sourceType: effect.sourceType,
              loreIds: effect.loreIds.filter((lore) => appLoreIds.has(lore)),
              spellId: "",
              powerLevel: effect.powerLevel,
            });
          }
        }
      }
    }

    for (const effect of boundItemEffects) {
      const item = findMagicItem(effect.itemName);
      if (!item) {
        continue;
      }
      const bearers = units.filter((unit) =>
        canTakeMagicItem(army, unit, item, armyComposition),
      );
      if (!bearers.length) {
        continue;
      }
      const spellId = spellsByName.get(effect.spellName.toLowerCase()) || "";
      effect.loreIds.forEach((lore) => boundLoreIds.add(lore));
      boundSpellSources.push({
        id: stableId(army.id, effect.itemName),
        name: effect.itemName,
        sourceType: effect.sourceType,
        loreIds: effect.loreIds.filter((lore) => appLoreIds.has(lore)),
        spellId,
        powerLevel: effect.powerLevel,
      });
    }
  }

  const uniqueCasterPresets = mergeUniqueObjects(casterPresets, (preset) => preset.id)
    .filter((preset) => preset.loreIds.length)
    .sort((left, right) => left.name.localeCompare(right.name));
  const uniqueBoundSources = mergeUniqueObjects(boundSpellSources, (source) => source.id)
    .filter((source) => source.loreIds.length)
    .sort((left, right) => left.name.localeCompare(right.name));

  uniqueCasterPresets.flatMap((preset) => preset.loreIds).forEach((lore) => mageLoreIds.add(lore));
  uniqueBoundSources.flatMap((source) => source.loreIds).forEach((lore) => boundLoreIds.add(lore));
  mageLoreIds.forEach((lore) => boundLoreIds.add(lore));

  report.factions.push({
    id: army.id,
    name: army.name_en,
    loreIds: [...mageLoreIds].sort(),
    boundLoreIds: [...boundLoreIds].sort(),
    casterPresets: uniqueCasterPresets,
    boundSpellSources: uniqueBoundSources,
  });
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      factions: report.factions.length,
      casterPresets: report.factions.reduce((sum, faction) => sum + faction.casterPresets.length, 0),
      boundSpellSources: report.factions.reduce((sum, faction) => sum + faction.boundSpellSources.length, 0),
      output: outFile,
    },
    null,
    2,
  ),
);
