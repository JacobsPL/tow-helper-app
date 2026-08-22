package com.towhelper.web;

import com.towhelper.catalog.CatalogService;
import com.towhelper.session.GameSession;
import com.towhelper.session.NotFoundException;
import com.towhelper.session.SessionService;
import com.towhelper.session.ValidationException;
import com.towhelper.session.ValidationMessage;
import io.javalin.Javalin;
import io.javalin.http.HttpStatus;
import io.javalin.http.staticfiles.Location;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

public final class HttpApi {
    private HttpApi() {
    }

    public static Javalin create(SessionService sessions, CatalogService catalog, Path cardsDir) {
        Javalin app = Javalin.create(config -> {
            config.showJavalinBanner = false;
            config.staticFiles.add(staticFiles -> {
                staticFiles.hostedPath = "/";
                staticFiles.directory = "/public";
                staticFiles.location = Location.CLASSPATH;
            });
            config.staticFiles.add(staticFiles -> {
                staticFiles.hostedPath = "/magic-cards";
                staticFiles.directory = cardsDir.toString();
                staticFiles.location = Location.EXTERNAL;
                staticFiles.headers = Map.of("Cache-Control", "public, max-age=31536000, immutable");
            });
        });

        app.get("/api/health", context -> context.json(Map.of("status", "ok")));
        app.get("/api/catalog", context -> context.json(catalog.response()));

        app.post("/api/sessions", context -> {
            GameSession session = sessions.createSession();
            context.status(HttpStatus.CREATED).json(sessions.response(session));
        });

        app.get("/api/sessions/{id}", context -> {
            GameSession session = sessions.getSession(context.pathParam("id"));
            context.json(sessions.response(session));
        });

        app.put("/api/sessions/{id}", context -> {
            GameSession incoming = context.bodyAsClass(GameSession.class);
            GameSession saved = sessions.saveSession(context.pathParam("id"), incoming);
            context.json(sessions.response(saved));
        });

        app.post("/api/sessions/{id}/start", context -> {
            GameSession session = sessions.startGame(context.pathParam("id"));
            context.json(sessions.response(session));
        });

        app.post("/api/sessions/{id}/end-turn", context -> {
            GameSession session = sessions.endTurn(context.pathParam("id"));
            context.json(sessions.response(session));
        });

        app.post("/api/sessions/{id}/used", context -> {
            UsedCardRequest request = context.bodyAsClass(UsedCardRequest.class);
            GameSession session = sessions.toggleUsedCard(context.pathParam("id"), request.key());
            context.json(sessions.response(session));
        });

        app.exception(NotFoundException.class, (exception, context) ->
                context.status(HttpStatus.NOT_FOUND).json(new ErrorResponse(List.of(
                        new ValidationMessage("not-found", exception.getMessage())
                )))
        );
        app.exception(ValidationException.class, (exception, context) ->
                context.status(HttpStatus.BAD_REQUEST).json(new ErrorResponse(exception.errors()))
        );

        return app;
    }

    private record UsedCardRequest(String key) {
    }

    private record ErrorResponse(List<ValidationMessage> errors) {
    }
}
