package com.towhelper.session;

import java.util.List;

public record SessionResponse(
        GameSession session,
        List<ValidationMessage> warnings,
        List<ValidationMessage> errors
) {
}
