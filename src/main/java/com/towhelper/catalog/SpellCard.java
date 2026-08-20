package com.towhelper.catalog;

public record SpellCard(
        String id,
        String loreId,
        String loreName,
        int sequence,
        String spellNumber,
        String spellName,
        String type,
        String castingValue,
        String range,
        String flavour,
        String effect,
        int pdfPage,
        String frontImage,
        String backImage,
        String frontUrl,
        String backUrl
) {
}
