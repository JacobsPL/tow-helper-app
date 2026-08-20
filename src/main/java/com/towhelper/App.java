package com.towhelper;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.towhelper.catalog.CatalogService;
import com.towhelper.session.SessionRepository;
import com.towhelper.session.SessionService;
import com.towhelper.web.HttpApi;
import io.javalin.Javalin;

import java.nio.file.Path;

public class App {
    public static void main(String[] args) throws Exception {
        int port = Integer.parseInt(value("PORT", "7070"));
        Path cardsDir = Path.of(value("TOW_CARDS_DIR", "assets/magic_cards"));
        Path databasePath = Path.of(value("TOW_DB", "data/tow-helper.sqlite"));

        ObjectMapper mapper = new ObjectMapper();
        CatalogService catalog = new CatalogService(cardsDir);
        SessionRepository repository = new SessionRepository(databasePath, mapper);
        SessionService sessions = new SessionService(repository, catalog);

        Javalin app = HttpApi.create(sessions, catalog, cardsDir.toAbsolutePath().normalize());
        app.start(port);
    }

    private static String value(String key, String fallback) {
        String property = System.getProperty(key);
        if (property != null && !property.isBlank()) {
            return property;
        }
        String environment = System.getenv(key);
        if (environment != null && !environment.isBlank()) {
            return environment;
        }
        return fallback;
    }
}
