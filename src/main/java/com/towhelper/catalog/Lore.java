package com.towhelper.catalog;

import java.util.List;

public record Lore(
        String id,
        String name,
        List<SpellCard> spells,
        String backUrl
) {
}
