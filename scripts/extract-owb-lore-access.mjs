import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const owbRoot = path.join(root, ".owb-source");
const gameDir = path.join(owbRoot, "public", "games", "the-old-world");
const outDir = path.join(root, "research");

const genericWizardingHatLores = [
  "battle-magic",
  "daemonology",
  "dark-magic",
  "elementalism",
  "high-magic",
  "illusion",
  "necromancy",
  "waaagh-magic",
  "shadowlands",
];

const loremasterLores = [
  "lore-of-saphery",
  "battle-magic",
  "elementalism",
  "high-magic",
  "illusion",
];

const itemLoreEffects = {
  "Wizarding Hat": {
    grants: genericWizardingHatLores,
    mode: "grants-extra-spell",
  },
  Loremaster: {
    grants: loremasterLores,
    mode: "replaces-native-lores",
  },
  "Arcane Familiar": {
    grants: [],
    mode: "unlocks-all-native-lores",
  },
  "Da Hag's Brew": {
    grants: ["troll-magic"],
    mode: "conditional-unlock",
  },
  "Heartwood Pendant*": {
    grants: ["lore-of-the-wilds"],
    mode: "conditional-unlock",
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

const gameSystem = readJson(path.join(owbRoot, "src", "assets", "the-old-world.json"));
const magicItems = readJson(path.join(gameDir, "magic-items.json"));
const enMessages = readJson(path.join(owbRoot, "src", "i18n", "en.json"));
const loresWithSpells = readJson(
  path.join(owbRoot, "src", "assets", "lores-of-magic-with-spells.json"),
);
const nameMap = readNameMap();

function displayName(id, fallback = id) {
  return nameMap[id]?.name_en || fallback;
}

function loreName(id) {
  return nameMap[id]?.name_en || enMessages[`magic.lore.${id}`] || id;
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

function loreIdFromRule(rule) {
  return rule
    .replace(/\s*\{renegade\}/g, "")
    .trim()
    .toLowerCase()
    .replace(/ /g, "-");
}

function specialRuleLores(entity, armyComposition) {
  const rules =
    compositionOverride(entity, armyComposition)?.specialRules ||
    entity.specialRules;
  return (rules?.name_en || "")
    .split(", ")
    .map((rule) => rule.trim())
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

function splitVisibleAndConditionalLores(entity, armyComposition) {
  const raw = getRawLores(entity, armyComposition).filter((lore) => loresWithSpells[lore]);
  const visible = [];
  const conditional = [];

  raw.forEach((lore, index) => {
    if (lore === "troll-magic" && armyComposition !== "troll-horde" && index !== 0) {
      conditional.push({
        lore,
        requiredItem: "Da Hag's Brew",
      });
      return;
    }
    if (
      lore === "lore-of-the-wilds" &&
      armyComposition !== "host-of-talsyn" &&
      index !== 0
    ) {
      conditional.push({
        lore,
        requiredItem: "Heartwood Pendant*",
      });
      return;
    }
    visible.push(lore);
  });

  return { visible, conditional };
}

function childCollections(entity) {
  return ["command", "mounts", "options", "equipment", "armor", "detachment"]
    .flatMap((key) =>
      Array.isArray(entity?.[key])
        ? entity[key].map((child) => ({ child, relation: key }))
        : [],
    );
}

function sourcePath(parentPath, entity) {
  const name = entity?.name_en || entity?.id || "Option";
  return parentPath ? `${parentPath} > ${name}` : name;
}

function collectLoreSources(entity, context, parentPath = "") {
  if (!entity || !isAvailableForComposition(entity, context.armyComposition)) {
    return [];
  }

  const pathName = sourcePath(parentPath, entity);
  const sources = [];
  const rawLores = splitVisibleAndConditionalLores(entity, context.armyComposition);
  const rules = specialRuleLores(entity, context.armyComposition);
  const option = optionLore(entity);
  const miaoYing = entity.id?.includes("miao-ying") ? ["miao-ying"] : [];
  const allVisible = [...new Set([...rawLores.visible, ...rules, option, ...miaoYing].filter(Boolean))];

  if (allVisible.length || rawLores.conditional.length) {
    sources.push({
      armyId: context.armyId,
      armyName: context.armyName,
      armyCompositionId: context.armyComposition,
      armyCompositionName: context.armyCompositionName,
      category: context.category,
      sourceType: context.category === "characters" ? "character" : "unit",
      unitId: context.unitId,
      unitName: context.unitName,
      sourceName: pathName,
      loreIds: allVisible,
      conditionalLores: rawLores.conditional,
      notes: [],
    });
  }

  for (const { child, relation } of childCollections(entity)) {
    sources.push(
      ...collectLoreSources(
        child,
        { ...context, sourceRelation: relation },
        pathName,
      ),
    );
  }

  return sources;
}

function unitAvailableInComposition(unit, armyComposition) {
  if (!unit.armyComposition) {
    return true;
  }
  return Boolean(unit.armyComposition[armyComposition]);
}

function armyDataForComposition(data, armyComposition) {
  const categories = ["characters", "core", "special", "rare", "mercenaries", "allies"];
  const result = {};
  for (const category of categories) {
    result[category] = (data[category] || []).filter((unit) =>
      unitAvailableInComposition(unit, armyComposition),
    );
  }
  return result;
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

function collectItemSources(army, unitsByCategory, armyComposition, compositionName, loreSources) {
  const units = Object.values(unitsByCategory).flat();
  const sources = [];

  for (const [itemName, effect] of Object.entries(itemLoreEffects)) {
    const item = findMagicItem(itemName);
    if (!item) {
      continue;
    }

    const bearers = units
      .filter((unit) => canTakeMagicItem(army, unit, item, armyComposition))
      .map((unit) => ({
        unitId: unit.id,
        unitName: unit.name_en,
        category:
          Object.entries(unitsByCategory).find(([, list]) => list.includes(unit))?.[0] ||
          "unknown",
      }));

    if (!bearers.length) {
      continue;
    }

    let loreIds = effect.grants;
    if (itemName === "Arcane Familiar") {
      const nativeLores = loreSources
        .filter((source) => bearers.some((bearer) => bearer.unitId === source.unitId))
        .flatMap((source) => source.loreIds);
      loreIds = [...new Set(nativeLores)];
    }

    if (itemName === "Da Hag's Brew" || itemName === "Heartwood Pendant*") {
      const conditionalLores = loreSources
        .filter((source) =>
          source.conditionalLores.some((entry) => entry.requiredItem === itemName),
        )
        .flatMap((source) =>
          source.conditionalLores
            .filter((entry) => entry.requiredItem === itemName)
            .map((entry) => entry.lore),
        );
      loreIds = [...new Set(conditionalLores)];
    }

    sources.push({
      armyId: army.id,
      armyName: army.name_en,
      armyCompositionId: armyComposition,
      armyCompositionName: compositionName,
      sourceType: "magic-item",
      itemName,
      itemCategory: item.itemCategory,
      itemType: item.type,
      mode: effect.mode,
      loreIds: [...new Set(loreIds)].filter(Boolean),
      bearers,
    });
  }

  return sources.filter((source) => source.loreIds.length);
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const report = {
  generatedAt: new Date().toISOString(),
  source: {
    repo: "https://github.com/nthiebes/old-world-builder",
    dataset: ".owb-source/public/games/the-old-world",
  },
  lores: Object.keys(loresWithSpells).map((id) => ({ id, name: loreName(id) })),
  armies: [],
};

const summaryRows = [];
const sourceRows = [];

for (const army of gameSystem.armies) {
  const armyFile = path.join(gameDir, `${army.id}.json`);
  if (!fs.existsSync(armyFile)) {
    continue;
  }

  const data = readJson(armyFile);
  const armyEntry = {
    id: army.id,
    name: army.name_en,
    compositions: [],
  };

  for (const armyComposition of army.armyComposition || [army.id]) {
    const armyCompositionName =
      armyComposition === army.id
        ? `${army.name_en} Grand Army`
        : displayName(armyComposition);
    const unitsByCategory = armyDataForComposition(data, armyComposition);
    const loreSources = [];

    for (const [category, units] of Object.entries(unitsByCategory)) {
      for (const unit of units) {
        const context = {
          armyId: army.id,
          armyName: army.name_en,
          armyComposition,
          armyCompositionName,
          category,
          unitId: unit.id,
          unitName: unit.name_en,
        };
        loreSources.push(...collectLoreSources(unit, context));
      }
    }

    const itemSources = collectItemSources(
      army,
      unitsByCategory,
      armyComposition,
      armyCompositionName,
      loreSources,
    );
    const nativeLoreIds = [
      ...new Set(loreSources.flatMap((source) => source.loreIds)),
    ].sort();
    const itemLoreIds = [
      ...new Set(itemSources.flatMap((source) => source.loreIds)),
    ].sort();
    const allLoreIds = [
      ...new Set([
        ...nativeLoreIds,
        ...itemLoreIds,
      ]),
    ].sort();

    const compositionEntry = {
      id: armyComposition,
      name: armyCompositionName,
      nativeLoreIds,
      nativeLoreNames: nativeLoreIds.map(loreName),
      itemLoreIds,
      itemLoreNames: itemLoreIds.map(loreName),
      allLoreIds,
      allLoreNames: allLoreIds.map(loreName),
      characterSources: loreSources.filter((source) => source.sourceType === "character"),
      otherSources: loreSources.filter((source) => source.sourceType !== "character"),
      itemSources,
    };
    armyEntry.compositions.push(compositionEntry);

    summaryRows.push({
      armyId: army.id,
      armyName: army.name_en,
      armyCompositionId: armyComposition,
      armyCompositionName,
      nativeLoreIds,
      nativeLoreNames: nativeLoreIds.map(loreName),
      itemLoreIds,
      itemLoreNames: itemLoreIds.map(loreName),
      allLoreIds,
      allLoreNames: allLoreIds.map(loreName),
      characterSourceCount: compositionEntry.characterSources.length,
      otherSourceCount: compositionEntry.otherSources.length,
      itemSourceCount: compositionEntry.itemSources.length,
    });

    for (const source of loreSources) {
      sourceRows.push({
        armyId: source.armyId,
        armyName: source.armyName,
        armyCompositionId: source.armyCompositionId,
        armyCompositionName: source.armyCompositionName,
        sourceType: source.sourceType,
        category: source.category,
        unitId: source.unitId,
        unitName: source.unitName,
        sourceName: source.sourceName,
        itemName: "",
        mode: "",
        loreIds: source.loreIds,
        loreNames: source.loreIds.map(loreName),
        conditionalLores: source.conditionalLores.map(
          (entry) => `${entry.lore} via ${entry.requiredItem}`,
        ),
      });
    }

    for (const source of itemSources) {
      sourceRows.push({
        armyId: source.armyId,
        armyName: source.armyName,
        armyCompositionId: source.armyCompositionId,
        armyCompositionName: source.armyCompositionName,
        sourceType: source.sourceType,
        category: "",
        unitId: "",
        unitName: source.bearers.map((bearer) => bearer.unitName),
        sourceName: "",
        itemName: source.itemName,
        mode: source.mode,
        loreIds: source.loreIds,
        loreNames: source.loreIds.map(loreName),
        conditionalLores: "",
      });
    }
  }

  report.armies.push(armyEntry);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "owb-lore-access.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

const summaryHeaders = [
  "armyId",
  "armyName",
  "armyCompositionId",
  "armyCompositionName",
  "nativeLoreIds",
  "nativeLoreNames",
  "itemLoreIds",
  "itemLoreNames",
  "allLoreIds",
  "allLoreNames",
  "characterSourceCount",
  "otherSourceCount",
  "itemSourceCount",
];
fs.writeFileSync(
  path.join(outDir, "owb-lore-access.csv"),
  `${summaryHeaders.join(",")}\n${summaryRows
    .map((row) => summaryHeaders.map((header) => csvEscape(row[header])).join(","))
    .join("\n")}\n`,
);

const sourceHeaders = [
  "armyId",
  "armyName",
  "armyCompositionId",
  "armyCompositionName",
  "sourceType",
  "category",
  "unitId",
  "unitName",
  "sourceName",
  "itemName",
  "mode",
  "loreIds",
  "loreNames",
  "conditionalLores",
];
fs.writeFileSync(
  path.join(outDir, "owb-lore-access-sources.csv"),
  `${sourceHeaders.join(",")}\n${sourceRows
    .map((row) => sourceHeaders.map((header) => csvEscape(row[header])).join(","))
    .join("\n")}\n`,
);

console.log(
  JSON.stringify(
    {
      armies: report.armies.length,
      compositions: summaryRows.length,
      sourceRows: sourceRows.length,
      output: [
        path.join(outDir, "owb-lore-access.json"),
        path.join(outDir, "owb-lore-access.csv"),
        path.join(outDir, "owb-lore-access-sources.csv"),
      ],
    },
    null,
    2,
  ),
);
