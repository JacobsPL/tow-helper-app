package com.towhelper.catalog;

import java.util.List;

public record CatalogResponse(List<Lore> lores, List<SpellCard> spells, List<FactionLoreAccess> factions) {
}
