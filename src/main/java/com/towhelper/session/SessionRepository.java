package com.towhelper.session;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.sqlite.SQLiteDataSource;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.Optional;

public class SessionRepository {
    private final SQLiteDataSource dataSource;
    private final ObjectMapper mapper;

    public SessionRepository(Path databasePath, ObjectMapper mapper) throws SQLException, IOException {
        this.mapper = mapper;
        Path absolutePath = databasePath.toAbsolutePath().normalize();
        Path parent = absolutePath.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        this.dataSource = new SQLiteDataSource();
        this.dataSource.setUrl("jdbc:sqlite:" + absolutePath);
        initialize();
    }

    public synchronized Optional<GameSession> findById(String id) {
        try (Connection connection = connection();
             PreparedStatement statement = connection.prepareStatement("select payload from game_sessions where id = ?")) {
            statement.setString(1, id);
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }
                return Optional.of(mapper.readValue(resultSet.getString("payload"), GameSession.class));
            }
        } catch (SQLException | JsonProcessingException exception) {
            throw new IllegalStateException("Could not read session " + id, exception);
        }
    }

    public synchronized void save(GameSession session) {
        String now = Instant.now().toString();
        if (session.createdAt == null || session.createdAt.isBlank()) {
            session.createdAt = now;
        }
        session.updatedAt = now;

        try (Connection connection = connection();
             PreparedStatement statement = connection.prepareStatement("""
                     insert into game_sessions (id, payload, created_at, updated_at)
                     values (?, ?, ?, ?)
                     on conflict(id) do update set
                         payload = excluded.payload,
                         updated_at = excluded.updated_at
                     """)) {
            statement.setString(1, session.id);
            statement.setString(2, mapper.writeValueAsString(session));
            statement.setString(3, session.createdAt);
            statement.setString(4, session.updatedAt);
            statement.executeUpdate();
        } catch (SQLException | JsonProcessingException exception) {
            throw new IllegalStateException("Could not save session " + session.id, exception);
        }
    }

    private void initialize() throws SQLException {
        try (Connection connection = connection();
             Statement statement = connection.createStatement()) {
            statement.execute("pragma journal_mode = WAL");
            statement.execute("""
                    create table if not exists game_sessions (
                        id text primary key,
                        payload text not null,
                        created_at text not null,
                        updated_at text not null
                    )
                    """);
        }
    }

    private Connection connection() throws SQLException {
        Connection connection = dataSource.getConnection();
        try (Statement statement = connection.createStatement()) {
            statement.execute("pragma foreign_keys = on");
        }
        return connection;
    }
}
