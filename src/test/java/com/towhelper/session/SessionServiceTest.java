package com.towhelper.session;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.towhelper.catalog.CatalogService;
import com.towhelper.catalog.Lore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SessionServiceTest {
    @TempDir
    Path tempDir;

    private CatalogService catalog;
    private SessionService service;

    @BeforeEach
    void setUp() throws Exception {
        catalog = new CatalogService(Path.of("assets/magic_cards"));
        SessionRepository repository = new SessionRepository(tempDir.resolve("sessions.sqlite"), new ObjectMapper());
        service = new SessionService(repository, catalog);
    }

    @Test
    void keepsSessionsIsolated() {
        Lore battleMagic = lore("battle_magic");
        GameSession first = service.createSession();
        GameSession second = service.createSession();

        Mage mage = mage("Adept", 1, battleMagic.id(), List.of(battleMagic.spells().get(0).id()));
        first.mages.add(mage);
        service.saveSession(first.id, first);

        GameSession loadedFirst = service.getSession(first.id);
        GameSession loadedSecond = service.getSession(second.id);

        assertThat(loadedFirst.mages).hasSize(1);
        assertThat(loadedSecond.mages).isEmpty();
    }

    @Test
    void warnsWhenMageKnowsMoreSpellsThanStandardLevelAllows() {
        Lore battleMagic = lore("battle_magic");
        GameSession session = service.createSession();
        session.mages.add(mage(
                "Praktykant",
                1,
                battleMagic.id(),
                List.of(battleMagic.spells().get(0).id(), battleMagic.spells().get(1).id())
        ));

        List<ValidationMessage> warnings = service.warnings(service.saveSession(session.id, session));

        assertThat(warnings)
                .extracting(ValidationMessage::code)
                .contains("mage-spell-limit");
    }

    @Test
    void warnsWhenMageHasNoSelectedSpellsButAllowsSaving() {
        Lore battleMagic = lore("battle_magic");
        GameSession session = service.createSession();
        session.mages.add(mage("Pusty Mag", 2, battleMagic.id(), List.of()));

        GameSession saved = service.saveSession(session.id, session);
        List<ValidationMessage> warnings = service.warnings(saved);

        assertThat(saved.mages.get(0).spellIds).isEmpty();
        assertThat(warnings)
                .extracting(ValidationMessage::code)
                .contains("mage-no-spells");
    }

    @Test
    void resetTurnClearsOnlyUsedCardsForCurrentSession() {
        Lore battleMagic = lore("battle_magic");
        GameSession first = preparedGameSession("Pierwszy", battleMagic);
        GameSession second = preparedGameSession("Drugi", battleMagic);

        first.usedCards.add(SessionService.spellKey(first.mages.get(0).id, first.mages.get(0).spellIds.get(0)));
        second.usedCards.add(SessionService.spellKey(second.mages.get(0).id, second.mages.get(0).spellIds.get(0)));
        service.saveSession(first.id, first);
        service.saveSession(second.id, second);

        service.endTurn(first.id);

        assertThat(service.getSession(first.id).usedCards).isEmpty();
        assertThat(service.getSession(second.id).usedCards).hasSize(1);
    }

    @Test
    void startGameRequiresAtLeastOneMageOrBoundSpell() {
        GameSession session = service.createSession();

        assertThatThrownBy(() -> service.startGame(session.id))
                .isInstanceOf(ValidationException.class)
                .satisfies(error -> assertThat(((ValidationException) error).errors())
                        .extracting(ValidationMessage::code)
                        .contains("empty-session"));
    }

    @Test
    void startGameRejectsMageWithoutLore() {
        GameSession session = service.createSession();
        session.playerFactionId = "empire-of-man";
        session.mages.add(mage("Bez domeny", 2, "", List.of()));
        service.saveSession(session.id, session);

        assertThatThrownBy(() -> service.startGame(session.id))
                .isInstanceOf(ValidationException.class)
                .satisfies(error -> assertThat(((ValidationException) error).errors())
                        .extracting(ValidationMessage::code)
                        .contains("mage-lore-missing"));
    }

    @Test
    void startGameAllowsOnlyOpponentSideMage() {
        Lore battleMagic = lore("battle_magic");
        GameSession session = service.createSession();
        session.opponentFactionId = "empire-of-man";
        Mage opponentMage = mage("Wrogi mag", 1, battleMagic.id(), List.of(battleMagic.spells().get(0).id()));
        opponentMage.side = "OPPONENT";
        session.mages.add(opponentMage);
        service.saveSession(session.id, session);

        GameSession started = service.startGame(session.id);

        assertThat(started.mode).isEqualTo("GAME");
        assertThat(started.mages).extracting(mage -> mage.side).containsExactly("OPPONENT");
    }

    @Test
    void startGameRequiresFactionOnlyForSideWithContent() {
        Lore battleMagic = lore("battle_magic");
        GameSession session = service.createSession();
        Mage playerMage = mage("Mag bez frakcji", 1, battleMagic.id(), List.of(battleMagic.spells().get(0).id()));
        session.mages.add(playerMage);
        service.saveSession(session.id, session);

        assertThatThrownBy(() -> service.startGame(session.id))
                .isInstanceOf(ValidationException.class)
                .satisfies(error -> assertThat(((ValidationException) error).errors())
                        .extracting(ValidationMessage::code)
                        .contains("side-faction-missing"));
    }

    @Test
    void clearsMageLoreAndSpellsWhenFactionDoesNotAllowLore() {
        Lore highMagic = lore("high_magic");
        GameSession session = service.createSession();
        session.playerFactionId = "empire-of-man";
        session.mages.add(mage("Nielegalny mag", 1, highMagic.id(), List.of(highMagic.spells().get(0).id())));

        GameSession saved = service.saveSession(session.id, session);

        assertThat(saved.mages.get(0).loreId).isEmpty();
        assertThat(saved.mages.get(0).spellIds).isEmpty();
    }

    @Test
    void factionFilteringIsIndependentForPlayerAndOpponent() {
        Lore highMagic = lore("high_magic");
        GameSession session = service.createSession();
        session.playerFactionId = "empire-of-man";
        session.opponentFactionId = "high-elf-realms";

        Mage playerMage = mage("Imperialny mag", 1, highMagic.id(), List.of(highMagic.spells().get(0).id()));
        playerMage.side = "PLAYER";
        Mage opponentMage = mage("Elficki mag", 1, highMagic.id(), List.of(highMagic.spells().get(0).id()));
        opponentMage.side = "OPPONENT";
        session.mages.add(playerMage);
        session.mages.add(opponentMage);

        GameSession saved = service.saveSession(session.id, session);

        assertThat(saved.mages.get(0).loreId).isEmpty();
        assertThat(saved.mages.get(1).loreId).isEqualTo(highMagic.id());
        assertThat(saved.mages.get(1).spellIds).hasSize(1);
    }

    @Test
    void allowsBoundSpellLoreFromFactionBoundSources() {
        Lore anvilOfDoom = lore("anvil_of_doom");
        GameSession session = service.createSession();
        session.playerFactionId = "dwarfen-mountain-holds";
        BoundSpell boundSpell = new BoundSpell();
        boundSpell.name = "Anvil";
        boundSpell.level = 1;
        boundSpell.loreId = anvilOfDoom.id();
        boundSpell.spellId = anvilOfDoom.spells().get(0).id();
        session.boundSpells.add(boundSpell);

        GameSession saved = service.saveSession(session.id, session);

        assertThat(saved.boundSpells.get(0).loreId).isEqualTo(anvilOfDoom.id());
        assertThat(saved.boundSpells.get(0).spellId).isEqualTo(anvilOfDoom.spells().get(0).id());
    }

    @Test
    void doesNotAllowBoundOnlyLoreForNormalMage() {
        Lore anvilOfDoom = lore("anvil_of_doom");
        GameSession session = service.createSession();
        session.playerFactionId = "dwarfen-mountain-holds";
        session.mages.add(mage("Runiczny test", 1, anvilOfDoom.id(), List.of(anvilOfDoom.spells().get(0).id())));

        GameSession saved = service.saveSession(session.id, session);

        assertThat(saved.mages.get(0).loreId).isEmpty();
        assertThat(saved.mages.get(0).spellIds).isEmpty();
    }

    @Test
    void casterPresetRestrictsMageLore() {
        Lore highMagic = lore("high_magic");
        GameSession session = service.createSession();
        session.playerFactionId = "wood-elf-realms";
        Mage mage = mage("Treeman", 2, highMagic.id(), List.of(highMagic.spells().get(0).id()));
        mage.casterPresetId = "wood-elf-realms-treeman-ancient";
        session.mages.add(mage);

        GameSession saved = service.saveSession(session.id, session);

        assertThat(saved.mages.get(0).casterPresetId).isEqualTo("wood-elf-realms-treeman-ancient");
        assertThat(saved.mages.get(0).loreId).isEmpty();
        assertThat(catalog.findCasterPreset("wood-elf-realms", "wood-elf-realms-treeman-ancient")).isPresent();
    }

    @Test
    void defaultsMissingOrInvalidSideToPlayer() {
        Lore battleMagic = lore("battle_magic");
        GameSession session = service.createSession();
        Mage mage = mage("Stary zapis", 1, battleMagic.id(), List.of(battleMagic.spells().get(0).id()));
        mage.side = "";
        BoundSpell boundSpell = new BoundSpell();
        boundSpell.side = "unknown";
        boundSpell.name = "Przedmiot";
        boundSpell.level = 2;
        boundSpell.loreId = battleMagic.id();
        boundSpell.spellId = battleMagic.spells().get(1).id();
        session.mages.add(mage);
        session.boundSpells.add(boundSpell);

        GameSession saved = service.saveSession(session.id, session);

        assertThat(saved.mages.get(0).side).isEqualTo("PLAYER");
        assertThat(saved.boundSpells.get(0).side).isEqualTo("PLAYER");
    }

    private GameSession preparedGameSession(String mageName, Lore lore) {
        GameSession session = service.createSession();
        session.playerFactionId = "empire-of-man";
        session.mages.add(mage(mageName, 1, lore.id(), List.of(lore.spells().get(0).id())));
        return service.startGame(service.saveSession(session.id, session).id);
    }

    @Test
    void armySignaturesSurviveSaveReloadUseAndEndTurnOnBothSides() {
        GameSession session = service.createSession();
        session.playerFactionId = "wood-elf-realms";
        session.opponentFactionId = "orc-and-goblin-tribes";
        Mage elf = mage("Elf", 2, "battle_magic", List.of(lore("battle_magic").spells().get(1).id(), lore("athel_loren").spells().get(0).id()));
        elf.casterPresetId = "wood-elf-realms-spellsinger";
        Mage goblin = mage("Goblin", 1, "waaagh_magic", List.of(lore("lore_of_mork").spells().get(0).id()));
        goblin.side = "OPPONENT";
        goblin.casterPresetId = "orc-and-goblin-tribes-goblin-oddgit";
        session.mages.addAll(List.of(elf, goblin));
        service.saveSession(session.id, session);
        GameSession started = service.startGame(session.id);
        assertThat(started.mages.get(0).spellIds).hasSize(2).contains(lore("athel_loren").spells().get(0).id());
        assertThat(started.mages.get(1).spellIds).containsExactly(lore("lore_of_mork").spells().get(0).id());
        String key = SessionService.spellKey(goblin.id, goblin.spellIds.get(0));
        service.toggleUsedCard(session.id, key);
        assertThat(service.getSession(session.id).usedCards).containsExactly(key);
        assertThat(service.endTurn(session.id).usedCards).isEmpty();
        assertThat(service.getSession(session.id).mages.get(1).spellIds).hasSize(1);
        assertThat(service.warnings(started)).isEmpty();
    }

    @Test
    void rejectsForeignAndWrongCasterSignatures() {
        GameSession session = service.createSession();
        session.playerFactionId = "orc-and-goblin-tribes";
        Mage goblin = mage("Goblin", 2, "waaagh_magic", List.of(
                lore("lore_of_gork").spells().get(0).id(), lore("athel_loren").spells().get(0).id(),
                lore("lore_of_mork").spells().get(0).id()));
        goblin.casterPresetId = "orc-and-goblin-tribes-goblin-oddgit";
        session.mages.add(goblin);
        assertThat(service.saveSession(session.id, session).mages.get(0).spellIds)
                .containsExactly(lore("lore_of_mork").spells().get(0).id());
        goblin.casterPresetId = "orc-and-goblin-tribes-orc-weirdboy";
        assertThat(service.saveSession(session.id, session).mages.get(0).spellIds).isEmpty();
    }

    @Test
    void chaosMarkAndCathayRuleRestrictSignaturePool() {
        GameSession session = service.createSession();
        session.playerFactionId = "warriors-of-chaos";
        Mage mage = mage("Chaos", 2, "dark_magic", List.of(
                lore("lore_of_chaos").spells().get(2).id(), lore("lore_of_chaos").spells().get(3).id()));
        mage.casterPresetId = "warriors-of-chaos-sorcerer-lord";
        mage.signatureOptionId = "lore-of-chaos-nurgle";
        session.mages.add(mage);
        assertThat(service.saveSession(session.id, session).mages.get(0).spellIds)
                .containsExactly(lore("lore_of_chaos").spells().get(2).id());
        session.playerFactionId = "grand-cathay";
        mage.casterPresetId = "grand-cathay-astromancer";
        mage.loreId = "battle_magic";
        mage.signatureOptionId = "lore_of_yin";
        mage.spellIds.addAll(List.of(lore("lore_of_yang").spells().get(0).id(), lore("lore_of_yin").spells().get(0).id()));
        assertThat(service.saveSession(session.id, session).mages.get(0).spellIds)
                .containsExactly(lore("lore_of_yin").spells().get(0).id());
    }

    @Test
    void trustsUserSignatureCountIncludingMiaoYing() {
        GameSession session = service.createSession();
        session.playerFactionId = "wood-elf-realms";
        Mage mage = mage("Elf", 4, "battle_magic", List.of(lore("battle_magic").spells().get(0).id(), lore("athel_loren").spells().get(0).id()));
        mage.casterPresetId = "wood-elf-realms-spellweaver";
        session.mages.add(mage);
        assertThat(service.warnings(service.saveSession(session.id, session)))
                .extracting(ValidationMessage::code).doesNotContain("mage-signature-limit");
        session.playerFactionId = "grand-cathay";
        mage.casterPresetId = "grand-cathay-miao-ying";
        mage.spellIds.clear();
        mage.spellIds.addAll(List.of(lore("miao_ying").spells().get(0).id(), lore("lore_of_yin").spells().get(0).id()));
        GameSession saved = service.saveSession(session.id, session);
        assertThat(saved.mages.get(0).spellIds).hasSize(2);
        assertThat(service.warnings(saved)).isEmpty();
    }

    @Test
    void allArmiesSeparateSignaturePoolsFromMainLores() {
        var signatureLores = List.of("athel_loren", "lore_of_beasts", "lore_of_chaos", "lore_of_daemons",
                "lore_of_gork", "lore_of_mork", "lore_of_hashut", "lore_of_lustria", "lore_of_naggaroth",
                "lore_of_nehekhara", "lore_of_saphery", "lore_of_the_lady", "lore_of_undeath",
                "the_great_maw", "the_horned_rat", "lore_of_yang", "lore_of_yin", "miao_ying");
        assertThat(catalog.factions()).hasSize(18);
        for (var faction : catalog.factions()) {
            assertThat(faction.loreIds()).doesNotContainAnyElementsOf(signatureLores);
            for (var preset : faction.casterPresets()) {
                assertThat(preset.loreIds()).doesNotContainAnyElementsOf(signatureLores);
                for (var option : preset.signatureOptions()) {
                    assertThat(option.spellIds()).isNotEmpty();
                    assertThat(option.spellIds()).allSatisfy(id ->
                            assertThat(catalog.findSpell(id).orElseThrow().loreId()).isIn(signatureLores));
                }
            }
        }
        assertThat(catalog.findFaction("wood-elf-realms").orElseThrow().loreIds()).contains("lore_of_the_wilds");
        assertThat(catalog.findFaction("beastmen-brayherds").orElseThrow().loreIds()).contains("primal_magic");
        assertThat(catalog.findFaction("warriors-of-chaos").orElseThrow().loreIds()).contains("lore_of_the_shadowlands");
        assertThat(catalog.findFaction("orc-and-goblin-tribes").orElseThrow().loreIds()).contains("troll_magic");
        assertThat(catalog.findCasterPreset("wood-elf-realms", "wood-elf-realms-shadowdancer").orElseThrow().signatureOptions()).isEmpty();
        assertThat(catalog.findCasterPreset("ogre-kingdoms", "ogre-kingdoms-firebelly").orElseThrow().signatureOptions()).isEmpty();
        var nurgle = catalog.findCasterPreset("daemons-of-chaos", "daemons-of-chaos-great-unclean-one").orElseThrow();
        assertThat(nurgle.signatureOptions()).hasSize(1);
        assertThat(nurgle.signatureOptions().get(0).spellIds()).containsExactly(lore("lore_of_daemons").spells().get(0).id());
    }

    @Test
    void legacyArmyLoreKeepsItsSignatureAndRequiresPrimaryLoreCorrection() {
        GameSession session = service.createSession();
        session.playerFactionId = "wood-elf-realms";
        session.mode = "GAME";
        Mage mage = mage("Stary mag", 1, "athel_loren", List.of(lore("athel_loren").spells().get(0).id()));
        mage.casterPresetId = "wood-elf-realms-spellsinger";
        session.mages.add(mage);
        GameSession saved = service.saveSession(session.id, session);
        assertThat(saved.mode).isEqualTo("CONFIG");
        assertThat(saved.mages.get(0).loreId).isEmpty();
        assertThat(saved.mages.get(0).spellIds).containsExactly(lore("athel_loren").spells().get(0).id());
        assertThat(service.startErrors(saved)).extracting(ValidationMessage::code).contains("mage-lore-missing");
        saved.mages.get(0).loreId = "battle_magic";
        assertThat(service.startGame(service.saveSession(session.id, saved).id).mages.get(0).spellIds).hasSize(1);
    }

    private Lore lore(String id) {
        return catalog.findLore(id).orElseThrow();
    }

    @Test
    void persistsBoundCommentsAndTreatsWhitespaceAsEmpty() {
        GameSession session = service.createSession();
        session.playerFactionId = "empire-of-man";
        Mage mage = mage("Mag", 1, "battle_magic", List.of());
        BoundSpell owned = new BoundSpell();
        owned.comment = "  Przy generale  ";
        mage.boundSpells.add(owned);
        session.mages.add(mage);
        BoundSpell standalone = new BoundSpell();
        standalone.comment = " \t\n\u00a0\u2003 ";
        session.boundSpells.add(standalone);
        service.saveSession(session.id, session);
        GameSession loaded = service.getSession(session.id);
        assertThat(loaded.mages.get(0).boundSpells.get(0).comment).isEqualTo("Przy generale");
        assertThat(loaded.boundSpells.get(0).comment).isEmpty();
        loaded.boundSpells.get(0).comment = "Zapasowy pierścień";
        loaded.mages.get(0).boundSpells.get(0).comment = null;
        service.saveSession(session.id, loaded);
        assertThat(service.getSession(session.id).boundSpells.get(0).comment).isEqualTo("Zapasowy pierścień");
        assertThat(service.getSession(session.id).mages.get(0).boundSpells.get(0).comment).isEmpty();
    }

    private Mage mage(String name, int level, String loreId, List<String> spells) {
        Mage mage = new Mage();
        mage.name = name;
        mage.level = level;
        mage.loreId = loreId;
        mage.spellIds.addAll(spells);
        return mage;
    }
}
