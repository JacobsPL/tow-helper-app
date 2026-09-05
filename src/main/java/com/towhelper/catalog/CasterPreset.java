package com.towhelper.catalog;

import java.util.List;

public record CasterPreset(
        String id,
        String name,
        int defaultLevel,
        List<String> loreIds,
        List<SignatureOption> signatureOptions,
        int maxSignatureSpells
) {
}
