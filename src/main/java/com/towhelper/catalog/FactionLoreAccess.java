package com.towhelper.catalog;

import java.util.List;

public record FactionLoreAccess(
        String id,
        String name,
        List<String> loreIds,
        List<String> boundLoreIds,
        List<CasterPreset> casterPresets,
        List<BoundSpellSource> boundSpellSources
) {
}
