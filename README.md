# TOW Helper App

Local web helper for managing magic cards during Warhammer: The Old World games.

## Current MVP

- Java backend with Javalin.
- SQLite session persistence.
- Independent game sessions identified by UUID.
- Player and opponent sides.
- Mage setup with faction-based caster presets and lore filtering.
- Bound Spells with a separate faction-specific lore pool.
- Magic card selection and per-turn usage tracking.
- Army signature replacement selection, including Chaos alignment and Miao Ying's two replacements.

## Run locally

Requires Java 17 and Maven.

```powershell
mvn test
mvn package
java -jar target\tow-helper-app-0.1.0-SNAPSHOT.jar
```

Open:

```text
http://localhost:7070/
```

## Data notes

Magic card images live in `assets/magic_cards`.
Faction magic access is generated into `src/main/resources/faction-magic-access.json`.
The helper scripts in `scripts/` can be used to rebuild derived catalog data.
The army signature rules audit and source links are in `research/army-signatures.md`.
