package com.towhelper.catalog;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

public class CatalogService {
    private static final String FACTION_MAGIC_RESOURCE = "/faction-magic-access.json";

    private final Path cardsDir;
    private final List<SpellCard> spells;
    private final List<FactionLoreAccess> factions;
    private final Map<String, SpellCard> spellsById;
    private final Map<String, Lore> loresById;
    private final Map<String, FactionLoreAccess> factionsById;
    private final CatalogResponse response;

    public CatalogService(Path cardsDir) throws IOException {
        this.cardsDir = cardsDir.toAbsolutePath().normalize();
        this.spells = loadSpells(this.cardsDir.resolve("all_spells.csv"));
        this.spellsById = indexSpells(this.spells);
        this.loresById = indexLores(this.spells);
        this.factions = loadFactions(this.loresById, this.spellsById);
        this.factionsById = indexFactions(this.factions);
        this.response = new CatalogResponse(
                List.copyOf(this.loresById.values()),
                this.spells,
                this.factions
        );
    }

    public CatalogResponse response() {
        return response;
    }

    public List<Lore> lores() {
        return response.lores();
    }

    public List<FactionLoreAccess> factions() {
        return response.factions();
    }

    public Optional<Lore> findLore(String loreId) {
        return Optional.ofNullable(loresById.get(loreId));
    }

    public Optional<FactionLoreAccess> findFaction(String factionId) {
        return Optional.ofNullable(factionsById.get(factionId));
    }

    public Optional<CasterPreset> findCasterPreset(String factionId, String casterPresetId) {
        return findFaction(factionId)
                .flatMap(faction -> faction.casterPresets().stream()
                        .filter(preset -> preset.id().equals(casterPresetId))
                        .findFirst());
    }

    public Optional<SpellCard> findSpell(String spellId) {
        return Optional.ofNullable(spellsById.get(spellId));
    }

    public boolean spellBelongsToLore(String spellId, String loreId) {
        return findSpell(spellId)
                .map(spell -> spell.loreId().equals(loreId))
                .orElse(false);
    }

    public boolean loreAvailableForFaction(String factionId, String loreId) {
        return findFaction(factionId)
                .map(faction -> faction.loreIds().contains(loreId))
                .orElse(false);
    }

    public boolean loreAvailableForCasterPreset(String factionId, String casterPresetId, String loreId) {
        return findCasterPreset(factionId, casterPresetId)
                .map(preset -> preset.loreIds().contains(loreId))
                .orElse(false);
    }

    public boolean boundLoreAvailableForFaction(String factionId, String loreId) {
        return findFaction(factionId)
                .map(faction -> faction.boundLoreIds().contains(loreId))
                .orElse(false);
    }

    public Path cardsDir() {
        return cardsDir;
    }

    private static List<SpellCard> loadSpells(Path csvPath) throws IOException {
        if (!Files.exists(csvPath)) {
            throw new IOException("Magic cards CSV does not exist: " + csvPath);
        }

        List<SpellCard> loaded = new ArrayList<>();
        try (BufferedReader reader = Files.newBufferedReader(csvPath, StandardCharsets.UTF_8)) {
            String header = reader.readLine();
            if (header == null) {
                return List.of();
            }

            String line;
            while ((line = reader.readLine()) != null) {
                if (line.isBlank()) {
                    continue;
                }
                List<String> values = CsvReader.parseLine(stripBom(line));
                if (values.size() < 13) {
                    continue;
                }

                String frontImage = normalizePath(values.get(11));
                String backImage = normalizePath(values.get(12));
                String loreId = frontImage.substring(0, frontImage.indexOf('/'));

                loaded.add(new SpellCard(
                        frontImage,
                        loreId,
                        values.get(0),
                        parseInt(values.get(1), 0),
                        values.get(2),
                        values.get(3),
                        values.get(4),
                        values.get(5),
                        values.get(6),
                        values.get(7),
                        values.get(8),
                        parseInt(values.get(9), 0),
                        frontImage,
                        backImage,
                        "/magic-cards/" + frontImage,
                        "/magic-cards/" + backImage
                ));
            }
        }
        return List.copyOf(loaded);
    }

    private static Map<String, SpellCard> indexSpells(List<SpellCard> spells) {
        Map<String, SpellCard> byId = new LinkedHashMap<>();
        for (SpellCard spell : spells) {
            byId.put(spell.id(), spell);
        }
        return Collections.unmodifiableMap(byId);
    }

    private static Map<String, Lore> indexLores(List<SpellCard> spells) {
        Map<String, List<SpellCard>> grouped = new LinkedHashMap<>();
        Map<String, String> names = new LinkedHashMap<>();
        Map<String, String> backs = new LinkedHashMap<>();

        for (SpellCard spell : spells) {
            grouped.computeIfAbsent(spell.loreId(), ignored -> new ArrayList<>()).add(spell);
            names.putIfAbsent(spell.loreId(), spell.loreName());
            backs.putIfAbsent(spell.loreId(), spell.backUrl());
        }

        Map<String, Lore> lores = new LinkedHashMap<>();
        grouped.forEach((id, loreSpells) -> lores.put(
                id,
                new Lore(id, names.get(id), List.copyOf(loreSpells), backs.get(id))
        ));
        return Collections.unmodifiableMap(lores);
    }

    private static Map<String, FactionLoreAccess> indexFactions(List<FactionLoreAccess> factions) {
        Map<String, FactionLoreAccess> byId = new LinkedHashMap<>();
        for (FactionLoreAccess faction : factions) {
            byId.put(faction.id(), faction);
        }
        return Collections.unmodifiableMap(byId);
    }

    private static List<FactionLoreAccess> loadFactions(
            Map<String, Lore> loresById,
            Map<String, SpellCard> spellsById
    ) throws IOException {
        try (InputStream stream = CatalogService.class.getResourceAsStream(FACTION_MAGIC_RESOURCE)) {
            if (stream == null) {
                return List.of();
            }
            FactionMagicCatalog catalog = new ObjectMapper().readValue(stream, FactionMagicCatalog.class);
            return catalog.factions().stream()
                    .map(faction -> sanitizeFaction(faction, loresById, spellsById))
                    .toList();
        }
    }

    private static FactionLoreAccess sanitizeFaction(
            FactionLoreAccess faction,
            Map<String, Lore> loresById,
            Map<String, SpellCard> spellsById
    ) {
        List<String> loreIds = knownLoreIds(faction.loreIds(), loresById);
        List<String> boundLoreIds = knownLoreIds(faction.boundLoreIds(), loresById);
        List<CasterPreset> casterPresets = listOrEmpty(faction.casterPresets()).stream()
                .map(preset -> new CasterPreset(
                        preset.id(),
                        preset.name(),
                        clampLevel(preset.defaultLevel()),
                        knownLoreIds(preset.loreIds(), loresById)
                ))
                .filter(preset -> !preset.id().isBlank())
                .filter(preset -> !preset.loreIds().isEmpty())
                .toList();
        List<BoundSpellSource> boundSpellSources = listOrEmpty(faction.boundSpellSources()).stream()
                .map(source -> new BoundSpellSource(
                        source.id(),
                        source.name(),
                        source.sourceType(),
                        knownLoreIds(source.loreIds(), loresById),
                        source.spellId() == null || spellsById.containsKey(source.spellId()) ? normalizeText(source.spellId()) : "",
                        Math.max(0, source.powerLevel())
                ))
                .filter(source -> !source.id().isBlank())
                .filter(source -> !source.loreIds().isEmpty())
                .toList();
        return new FactionLoreAccess(
                normalizeText(faction.id()),
                normalizeText(faction.name()),
                loreIds,
                boundLoreIds,
                casterPresets,
                boundSpellSources
        );
    }

    private static List<String> knownLoreIds(List<String> loreIds, Map<String, Lore> loresById) {
        return listOrEmpty(loreIds).stream()
                .map(CatalogService::normalizeText)
                .distinct()
                .filter(loresById::containsKey)
                .toList();
    }

    private static <T> List<T> listOrEmpty(List<T> values) {
        return values == null ? List.of() : values;
    }

    private static String normalizePath(String value) {
        return value.replace('\\', '/');
    }

    private static String normalizeText(String value) {
        return value == null ? "" : value.trim();
    }

    private static String stripBom(String value) {
        if (!value.isEmpty() && value.charAt(0) == '\ufeff') {
            return value.substring(1);
        }
        return value;
    }

    private static int parseInt(String value, int fallback) {
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private static int clampLevel(int level) {
        if (level < 1) {
            return 1;
        }
        if (level > 4) {
            return 4;
        }
        return level;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record FactionMagicCatalog(List<FactionLoreAccess> factions) {
    }
}
