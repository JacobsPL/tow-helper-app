package com.towhelper.catalog;

import java.util.List;

public record BoundSpellSource(
        String id,
        String name,
        String sourceType,
        List<String> loreIds,
        String spellId,
        int powerLevel
) {
}
