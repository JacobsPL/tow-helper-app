package com.towhelper.session;

import com.towhelper.catalog.CatalogService;
import com.towhelper.catalog.SignatureOption;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

public class SessionService {
    private static final Set<String> VALID_MODES = Set.of("CONFIG", "GAME");
    private static final Set<String> VALID_SIDES = Set.of("PLAYER", "OPPONENT");

    private final SessionRepository repository;
    private final CatalogService catalog;

    public SessionService(SessionRepository repository, CatalogService catalog) {
        this.repository = repository;
        this.catalog = catalog;
    }

    public GameSession createSession() {
        GameSession session = new GameSession();
        session.id = UUID.randomUUID().toString();
        sanitize(session);
        repository.save(session);
        return session;
    }

    public GameSession getSession(String id) {
        return repository.findById(id)
                .map(this::sanitize)
                .orElseThrow(() -> new NotFoundException("Nie znaleziono sesji gry: " + id));
    }

    public GameSession saveSession(String id, GameSession incoming) {
        GameSession existing = getSession(id);
        incoming.id = id;
        incoming.createdAt = existing.createdAt;
        sanitize(incoming);
        repository.save(incoming);
        return incoming;
    }

    public GameSession startGame(String id) {
        GameSession session = getSession(id);
        List<ValidationMessage> errors = startErrors(session);
        if (!errors.isEmpty()) {
            throw new ValidationException(errors);
        }
        session.mode = "GAME";
        sanitize(session);
        repository.save(session);
        return session;
    }

    public GameSession endTurn(String id) {
        GameSession session = getSession(id);
        session.usedCards.clear();
        repository.save(session);
        return session;
    }

    public GameSession toggleUsedCard(String id, String cardKey) {
        GameSession session = getSession(id);
        if (session.usedCards.contains(cardKey)) {
            session.usedCards.remove(cardKey);
        } else {
            session.usedCards.add(cardKey);
        }
        repository.save(session);
        return session;
    }

    public SessionResponse response(GameSession session) {
        sanitize(session);
        return new SessionResponse(session, warnings(session), startErrors(session));
    }

    public List<ValidationMessage> warnings(GameSession session) {
        List<ValidationMessage> warnings = new ArrayList<>();
        if (session.mages.isEmpty() && session.boundSpells.isEmpty()) {
            warnings.add(new ValidationMessage("empty-session", "Dodaj przynajmniej maga albo Bound Spell przed rozpoczęciem gry."));
        }
        for (String side : sidesWithContent(session)) {
            if (blank(factionIdForSide(session, side))) {
                warnings.add(new ValidationMessage("side-faction-missing", sideLabel(side) + " ma elementy sesji bez wybranej frakcji."));
            }
        }

        for (Mage mage : session.mages) {
            String mageName = displayName(mage.name, "Mag");
            if (blank(mage.loreId)) {
                warnings.add(new ValidationMessage("mage-lore-missing", mageName + " nie ma wybranego Lore."));
            }
            if (mage.spellIds.isEmpty()) {
                warnings.add(new ValidationMessage("mage-no-spells", mageName + " nie ma wybranego żadnego czaru."));
            }
            if (mage.spellIds.size() > mage.level) {
                warnings.add(new ValidationMessage(
                        "mage-spell-limit",
                        mageName + " zna " + mage.spellIds.size() + " czarów, a standardowy limit dla poziomu "
                                + mage.level + " to " + mage.level + ". Możesz to zatwierdzić jako wyjątek."
                ));
            }

        }

        for (BoundSpell boundSpell : allBoundSpells(session)) {
            String name = displayName(boundSpell.name, "Bound Spell");
            if (blank(boundSpell.loreId)) {
                warnings.add(new ValidationMessage("bound-lore-missing", name + " nie ma wybranego Lore."));
            }
            if (blank(boundSpell.spellId)) {
                warnings.add(new ValidationMessage("bound-spell-missing", name + " nie ma wybranego czaru."));
            }
        }

        return warnings;
    }

    public List<ValidationMessage> startErrors(GameSession session) {
        List<ValidationMessage> errors = new ArrayList<>();
        if (session.mages.isEmpty() && session.boundSpells.isEmpty()) {
            errors.add(new ValidationMessage("empty-session", "Nie można rozpocząć gry bez maga albo Bound Spella."));
        }
        for (String side : sidesWithContent(session)) {
            if (blank(factionIdForSide(session, side))) {
                errors.add(new ValidationMessage("side-faction-missing", sideLabel(side) + " musi mieć wybraną frakcję przed rozpoczęciem gry."));
            }
        }

        for (Mage mage : session.mages) {
            String mageName = displayName(mage.name, "Mag");
            if (blank(mage.loreId)) {
                errors.add(new ValidationMessage("mage-lore-missing", mageName + " musi mieć wybrane Lore przed rozpoczęciem gry."));
            }
        }

        for (BoundSpell boundSpell : allBoundSpells(session)) {
            String name = displayName(boundSpell.name, "Bound Spell");
            if (blank(boundSpell.loreId) || blank(boundSpell.spellId)) {
                errors.add(new ValidationMessage("bound-incomplete", name + " musi mieć Lore i dokładnie jeden czar."));
            }
        }

        return errors;
    }

    GameSession sanitize(GameSession session) {
        if (session.id == null || session.id.isBlank()) {
            session.id = UUID.randomUUID().toString();
        }
        if (!VALID_MODES.contains(session.mode)) {
            session.mode = "CONFIG";
        }
        session.playerFactionId = normalizeFaction(session.playerFactionId);
        session.opponentFactionId = normalizeFaction(session.opponentFactionId);
        if (session.mages == null) {
            session.mages = new ArrayList<>();
        }
        if (session.boundSpells == null) {
            session.boundSpells = new ArrayList<>();
        }
        if (session.usedCards == null) {
            session.usedCards = new LinkedHashSet<>();
        }

        session.mages.removeIf(Objects::isNull);
        for (Mage mage : session.mages) {
            sanitizeMage(session, mage);
        }
        if ("GAME".equals(session.mode) && session.mages.stream().anyMatch(mage -> blank(mage.loreId))) {
            session.mode = "CONFIG";
        }

        session.boundSpells.removeIf(Objects::isNull);
        for (BoundSpell boundSpell : session.boundSpells) {
            sanitizeBoundSpell(session, boundSpell);
        }

        Set<String> allowedUsedCards = allowedUsedCardKeys(session);
        session.usedCards.removeIf(key -> !allowedUsedCards.contains(key));
        return session;
    }

    private void sanitizeMage(GameSession session, Mage mage) {
        if (mage.id == null || mage.id.isBlank()) {
            mage.id = UUID.randomUUID().toString();
        }
        mage.side = normalizeSide(mage.side);
        mage.casterPresetId = normalizeCasterPreset(session, mage.side, mage.casterPresetId);
        mage.name = normalizeText(mage.name);
        mage.note = normalizeText(mage.note);
        mage.level = clampLevel(mage.level);
        mage.loreId = normalizeText(mage.loreId);
        if (catalog.findLore(mage.loreId).isEmpty()) {
            mage.loreId = "";
        }
        if (!mageLoreAllowed(session, mage, mage.loreId)) {
            mage.loreId = "";
        }
        if (mage.spellIds == null) {
            mage.spellIds = new ArrayList<>();
        }
        var preset = catalog.findCasterPreset(factionIdForSide(session, mage.side), mage.casterPresetId).orElse(null);
        var options = preset == null ? List.<SignatureOption>of() : preset.signatureOptions();
        mage.signatureOptionId = normalizeText(mage.signatureOptionId);
        var signatureOption = options.stream().filter(option -> option.id().equals(mage.signatureOptionId)).findFirst()
                .orElse(options.size() == 1 ? options.get(0) : null);
        // Older saves could use an army signature pool as the primary lore.
        // Keep its cards while asking the player to select a real primary lore.
        if (signatureOption == null && blank(mage.loreId) && !mage.spellIds.isEmpty()) {
            var matchingOptions = options.stream().filter(option -> option.spellIds().containsAll(mage.spellIds)).toList();
            if (matchingOptions.size() == 1) signatureOption = matchingOptions.get(0);
        }
        mage.signatureOptionId = signatureOption == null ? "" : signatureOption.id();
        var signatureSpells = signatureOption == null ? List.<String>of() : signatureOption.spellIds();
        mage.spellIds.removeIf(spellId -> !catalog.spellBelongsToLore(spellId, mage.loreId) && !signatureSpells.contains(spellId));
        mage.spellIds = new ArrayList<>(new LinkedHashSet<>(mage.spellIds));

        if (mage.boundSpells == null) {
            mage.boundSpells = new ArrayList<>();
        }
        mage.boundSpells.removeIf(Objects::isNull);
        for (BoundSpell boundSpell : mage.boundSpells) {
            boundSpell.side = mage.side;
            sanitizeBoundSpell(session, boundSpell);
            boundSpell.side = mage.side;
        }
    }

    private void sanitizeBoundSpell(GameSession session, BoundSpell boundSpell) {
        if (boundSpell.id == null || boundSpell.id.isBlank()) {
            boundSpell.id = UUID.randomUUID().toString();
        }
        boundSpell.side = normalizeSide(boundSpell.side);
        boundSpell.sourceId = normalizeText(boundSpell.sourceId);
        boundSpell.name = normalizeText(boundSpell.name);
        boundSpell.comment = boundSpell.comment == null ? "" : boundSpell.comment.replaceAll("(?U)^\\s+|\\s+$", "");
        boundSpell.level = clampLevel(boundSpell.level);
        boundSpell.loreId = normalizeText(boundSpell.loreId);
        boundSpell.spellId = normalizeText(boundSpell.spellId);
        if (catalog.findLore(boundSpell.loreId).isEmpty()) {
            boundSpell.loreId = "";
            boundSpell.spellId = "";
        }
        if (!boundLoreAllowed(session, boundSpell.side, boundSpell.loreId)) {
            boundSpell.loreId = "";
            boundSpell.spellId = "";
        }
        if (!catalog.spellBelongsToLore(boundSpell.spellId, boundSpell.loreId)) {
            boundSpell.spellId = "";
        }
    }

    private Set<String> allowedUsedCardKeys(GameSession session) {
        Set<String> keys = new LinkedHashSet<>();
        for (Mage mage : session.mages) {
            for (String spellId : mage.spellIds) {
                keys.add(spellKey(mage.id, spellId));
            }
            for (BoundSpell boundSpell : mage.boundSpells) {
                if (!blank(boundSpell.spellId)) {
                    keys.add(boundKey(boundSpell.id));
                }
            }
        }
        for (BoundSpell boundSpell : session.boundSpells) {
            if (!blank(boundSpell.spellId)) {
                keys.add(boundKey(boundSpell.id));
            }
        }
        return keys;
    }

    private List<BoundSpell> allBoundSpells(GameSession session) {
        List<BoundSpell> boundSpells = new ArrayList<>(session.boundSpells);
        for (Mage mage : session.mages) {
            boundSpells.addAll(mage.boundSpells);
        }
        return boundSpells;
    }

    private Set<String> sidesWithContent(GameSession session) {
        Set<String> sides = new LinkedHashSet<>();
        for (Mage mage : session.mages) {
            sides.add(normalizeSide(mage.side));
        }
        for (BoundSpell boundSpell : session.boundSpells) {
            sides.add(normalizeSide(boundSpell.side));
        }
        return sides;
    }

    private boolean mageLoreAllowed(GameSession session, Mage mage, String loreId) {
        if (blank(loreId)) {
            return true;
        }
        String factionId = factionIdForSide(session, mage.side);
        if (blank(factionId)) {
            return true;
        }
        if (!blank(mage.casterPresetId)) {
            return catalog.loreAvailableForCasterPreset(factionId, mage.casterPresetId, loreId);
        }
        return catalog.loreAvailableForFaction(factionId, loreId);
    }

    private boolean boundLoreAllowed(GameSession session, String side, String loreId) {
        if (blank(loreId)) {
            return true;
        }
        String factionId = factionIdForSide(session, side);
        return blank(factionId) || catalog.boundLoreAvailableForFaction(factionId, loreId);
    }

    private String factionIdForSide(GameSession session, String side) {
        return "OPPONENT".equals(normalizeSide(side)) ? session.opponentFactionId : session.playerFactionId;
    }

    private String normalizeCasterPreset(GameSession session, String side, String casterPresetId) {
        String normalized = normalizeText(casterPresetId);
        if (blank(normalized)) {
            return "";
        }
        String factionId = factionIdForSide(session, side);
        return catalog.findCasterPreset(factionId, normalized).isPresent() ? normalized : "";
    }

    public static String spellKey(String mageId, String spellId) {
        return "spell:" + mageId + ":" + spellId;
    }

    public static String boundKey(String boundSpellId) {
        return "bound:" + boundSpellId;
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

    private static String normalizeText(String value) {
        return value == null ? "" : value.trim();
    }

    private static String normalizeSide(String side) {
        String normalized = normalizeText(side).toUpperCase();
        return VALID_SIDES.contains(normalized) ? normalized : "PLAYER";
    }

    private String normalizeFaction(String factionId) {
        String normalized = normalizeText(factionId);
        return catalog.findFaction(normalized).isPresent() ? normalized : "";
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static String displayName(String value, String fallback) {
        return blank(value) ? fallback : value.trim();
    }

    private static String sideLabel(String side) {
        return "OPPONENT".equals(normalizeSide(side)) ? "Przeciwnik" : "Gracz";
    }
}
