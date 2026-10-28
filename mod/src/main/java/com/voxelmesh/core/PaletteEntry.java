package com.voxelmesh.core;

import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.stream.Collectors;

/**
 * One palette entry; `color` is "#RRGGBB". Air (index 0) is added by {@link PayloadWriter}, never stored here.
 * `relief` is optional: 1536 luma bytes (see {@link ReliefSampler}) for full-cube blocks, else null.
 * `tags` are optional labels the web app can filter on ({@link #GLASS}, {@link #LEAVES}).
 * `faces` is optional: six "#RRGGBB" face colours in Direction order (DOWN, UP, NORTH, SOUTH, WEST, EAST), present only when the
 * faces of a full-cube block really differ (see {@link FaceColors}); empty otherwise.
 * `model` is optional: the shape and colours the game actually draws, for blocks whose hitbox differs from their look.
 */
public record PaletteEntry(String id, String name, String color, Category category, List<int[]> boxes, byte[] relief, List<String> tags, List<String> faces, BlockModel model) {
    public static final String GLASS = "glass";
    public static final String LEAVES = "leaves";

    public PaletteEntry {
        tags = tags == null ? List.of() : List.copyOf(tags);
        faces = faces == null ? List.of() : List.copyOf(faces);
        if (!faces.isEmpty() && faces.size() != ReliefSampler.FACES) throw new IllegalArgumentException("faces must be empty or have 6 colours");
    }

    public PaletteEntry(String id, String name, String color, Category category, List<int[]> boxes, byte[] relief, List<String> tags, List<String> faces) {
        this(id, name, color, category, boxes, relief, tags, faces, null);
    }

    public PaletteEntry(String id, String name, String color, Category category, List<int[]> boxes, byte[] relief, List<String> tags) {
        this(id, name, color, category, boxes, relief, tags, List.of(), null);
    }

    public PaletteEntry(String id, String name, String color, Category category, List<int[]> boxes, byte[] relief) {
        this(id, name, color, category, boxes, relief, List.of(), List.of(), null);
    }

    public PaletteEntry(String id, String name, String color, Category category, List<int[]> boxes) {
        this(id, name, color, category, boxes, null, List.of(), List.of(), null);
    }

    /**
     * Everything the web app uses to print this block: category, boxes, colour, face colours, model, relief and tags, but not the id or name. Two
     * block states with the same key are interchangeable (for example leaves that differ only in `distance`), so the capture
     * stores them once.
     */
    public String contentKey() {
        String b = boxes.stream().map(Arrays::toString).collect(Collectors.joining(";"));
        String r = relief == null ? "" : Base64.getEncoder().encodeToString(relief);
        String t = tags.stream().sorted().collect(Collectors.joining(","));
        return category.json() + "|" + b + "|" + color + "|" + r + "|" + t + "|" + String.join(",", faces) + "|" + (model == null ? "" : model.key());
    }
}
