package com.towhelper.session;

import java.util.List;

public class ValidationException extends RuntimeException {
    private final List<ValidationMessage> errors;

    public ValidationException(List<ValidationMessage> errors) {
        super(errors.isEmpty() ? "Validation failed" : errors.get(0).message());
        this.errors = errors;
    }

    public List<ValidationMessage> errors() {
        return errors;
    }
}
