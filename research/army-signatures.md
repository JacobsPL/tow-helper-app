# Army signature audit — 2026-09-05

Reviewed all 18 factions listed by [Old World Builder](https://old-world-builder.com/new).
The app's OWB source checkout is `4f78d6b` (2026-08-17), repository
[nthiebes/old-world-builder](https://github.com/nthiebes/old-world-builder).
Caster access comes from its `public/games/the-old-world/*.json`, composition overrides,
special rules and options. Classification and replacement rules were checked against
[The Lores of Magic](https://tow.whfb.app/the-lores-of-magic).

Also fetched and compared all 18 army datasets against OWB commit
`614bbd6ada27548e4656a9db5e28ca6bdfd50d63` (2026-09-04). The relevant replacement
pool rules and god assignments are unchanged. New Renegade unit variants and
unrelated roster changes were not imported as part of this signature fix.

The former generator incorrectly merged the special-rule pools into each caster's
primary `loreIds`. It now generates separate `signatureOptions` with exact spell IDs.
Access is attached to the caster, not granted to every character in the faction.
The existing union of army compositions and conditional primary lores is retained;
this helper does not validate a complete points roster or equipment requirements.

| Faction | Replacement pool moved out of primary selection | Notes |
| --- | --- | --- |
| Beastmen Brayherds | [Beasts](https://tow.whfb.app/the-lores-of-magic/lore-of-beasts) | Bray-Shamans and Kralmaw; not Doombull/Gorebull |
| Chaos Dwarfs | [Hashut](https://tow.whfb.app/the-lores-of-magic/lore-of-hashut) | Sorcerer-Prophet and Daemonsmith |
| Daemons of Chaos | [Daemons](https://tow.whfb.app/the-lores-of-magic/lore-of-daemons) | Fixed alignment for named god profiles; Daemon Prince chooses alignment. Nurgle: Plague Wind; Slaanesh: Cacophonic Hymn; Tzeentch: Pink Fire or Gift of Mutation |
| Dark Elves | [Naggaroth](https://tow.whfb.app/the-lores-of-magic/lore-of-naggaroth) | Sorceresses |
| Dwarfen Mountain Holds | None | Anvil remains a bound source |
| Empire of Man | None | Primary lores unchanged |
| Grand Cathay | [Yang](https://tow.whfb.app/the-lores-of-magic/lore-of-yang), [Yin](https://tow.whfb.app/the-lores-of-magic/lore-of-yin); Miao Ying's spell | Ordinary casters choose one rule from their roster; Miao Ying gets a combined pool |
| High Elf Realms | [Saphery](https://tow.whfb.app/the-lores-of-magic/lore-of-saphery) | Access follows caster special rules |
| Kingdom of Bretonnia | [The Lady](https://tow.whfb.app/the-lores-of-magic/lore-of-the-lady) | Damsel, Prophetess, Élisse; not Outcast Wizard |
| Lizardmen | [Lustria](https://tow.whfb.app/the-lores-of-magic/lore-of-lustria) | Slann and Skink Priest |
| Ogre Kingdoms | [Great Maw](https://tow.whfb.app/the-lores-of-magic/lore-of-the-great-maw) | Butcher and Slaughtermaster; not Firebelly |
| Orc & Goblin Tribes | [Gork](https://tow.whfb.app/the-lores-of-magic/lore-of-gork), [Mork](https://tow.whfb.app/the-lores-of-magic/lore-of-mork) | Orc shamans get Gork; Goblin and Night Goblin shamans get Mork; no automatic access for Troll Hag/Ogdruz |
| Renegade Crowns | None | Outcast Wizard's primary lores unchanged |
| Skaven | [Horned Rat](https://tow.whfb.app/the-lores-of-magic/lore-of-the-horned-rat) | Grey Seer, Plague Priest, Warlock Engineer |
| Tomb Kings of Khemri | [Nehekhara](https://tow.whfb.app/the-lores-of-magic/lore-of-nehekhara) | Priests and Settra; optional wizard kings/princes do not automatically gain the rule |
| Vampire Counts | [Undeath](https://tow.whfb.app/the-lores-of-magic/lore-of-undeath) | Access follows caster special rules |
| Warriors of Chaos | [Chaos](https://tow.whfb.app/the-lores-of-magic/lore-of-chaos), Beasts for Bray-Shamans | Chaos spell filtered by selected Mark; Galrauch does not acquire this rule from faction membership |
| Wood Elf Realms | [Athel Loren](https://tow.whfb.app/the-lores-of-magic/lore-of-athel-loren) | Spellsinger, Spellweaver, Branchwraith and Treeman Ancient; not Shadowdancer |

## Replacement and exceptions

UX update: signature cards are now freely toggled on/off. There is no replacement
dropdown, count restriction or count warning in the selection UI. The user manages
the legal number of spells and removes any replaced spell manually. Eligibility by
caster and selected army rule remains checked. The verification below describes
the initial implementation; the updated version also passes all 20 backend tests.

[Spell generation](https://tow.whfb.app/the-lores-of-magic/spells-and-spell-generation)
normally allows one replacement, using either the primary signature or an eligible
army signature. It does not grant another known spell. The selection UI can replace
a selected spell or fill an empty slot, counts primary and army signatures together,
and provides warnings for manually selected exceptional sets. Backend checks retain
only spells from the primary lore or the selected eligible army rule.

[Miao Ying's Mastery of the Storm Winds](https://tow.whfb.app/special-rules/mastery-of-the-storm-winds)
permits two replacements, chosen among Yang, Yin, her primary signature and
The Storm Dragon's Fury. This is represented by `maxSignatureSpells: 2`.

The following are full primary lores and were deliberately retained:
[Wilds](https://tow.whfb.app/the-lores-of-magic/lore-of-the-wilds),
[Primal Magic](https://tow.whfb.app/the-lores-of-magic/lore-of-primal-magic),
[Troll Magic](https://tow.whfb.app/the-lores-of-magic/lore-of-troll-magic), and
[Shadowlands](https://tow.whfb.app/the-lores-of-magic/lore-of-the-shadowlands).

No spell text or card artwork was changed in this audit. Bound sources keep their
previous catalog access. Existing invalid primary-lore choices must be corrected
in configuration; the application preserves eligible signature cards and does not
infer a player's main lore. An affected game opens in configuration for correction.

## Verification

- Maven package: 20 tests passed, including both sides, persistence, turn reset,
  wrong-faction/caster/god rejection, 18-faction catalog separation and legacy saves.
- Browser: Wood Elf and Goblin signatures added, swapped, saved and used in a game;
  used state survived reload and cleared on end turn.
- Browser: Miao Ying replaced two of four spells; Chaos displayed the selected
  god's spell only; canceling a changed Mark preserved the saved set.
- Browser layout: 1080×810 and 1024×768 landscape, 810×1080 portrait and 390×844
  phone. Panels/cards stayed within their columns, without horizontal overflow.
  These were viewport tests, not a test on physical iPad Safari.
