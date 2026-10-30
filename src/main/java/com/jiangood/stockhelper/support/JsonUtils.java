package com.jiangood.stockhelper.support;

import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.Map;

public final class JsonUtils {

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();

    private JsonUtils() {
    }

    public static ObjectMapper mapper() {
        return MAPPER;
    }

    public static String write(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JacksonException e) {
            throw new IllegalStateException("JSON 序列化失败", e);
        }
    }

    public static <T> T read(String json, Class<T> type) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return MAPPER.readValue(json, type);
        } catch (JacksonException e) {
            throw new IllegalStateException("JSON 解析失败", e);
        }
    }

    public static List<Map<String, Object>> readList(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return MAPPER.readValue(json, new TypeReference<>() {
            });
        } catch (JacksonException e) {
            throw new IllegalStateException("JSON 解析失败", e);
        }
    }

    public static List<Object> readAnyList(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return MAPPER.readValue(json, new TypeReference<List<Object>>() {
            });
        } catch (JacksonException e) {
            throw new IllegalStateException("JSON 解析失败", e);
        }
    }

    public static Map<String, Object> readMap(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return MAPPER.readValue(json, new TypeReference<>() {
            });
        } catch (JacksonException e) {
            throw new IllegalStateException("JSON 解析失败", e);
        }
    }
}
