import { describe, expect, it } from "vitest";
import {
  buildOnlineFallbackStyle,
  buildShortbreadVectorStyle,
  parseBounds,
  parseCenter
} from "../src/map/tileServer";

describe("tileServer style helpers", () => {
  it("parses bounds and center metadata safely", () => {
    expect(parseBounds("116.85,4.2,126.9,21.35")).toEqual([116.85, 4.2, 126.9, 21.35]);
    expect(parseBounds("broken")).toBeNull();
    expect(parseCenter("121.774,12.8797,6")).toEqual([121.774, 12.8797]);
    expect(parseCenter("invalid")).toBeNull();
  });

  it("builds a vector style for shortbread mbtiles", () => {
    const style = buildShortbreadVectorStyle({
      host: "http://127.0.0.1:38000",
      bounds: [116.85, 4.2, 126.9, 21.35],
      center: [121.774, 12.8797],
      zoom: 5.6
    });

    expect(style.version).toBe(8);
    expect(style.glyphs).toBeUndefined();
    expect(style.sources.offline.type).toBe("vector");
    expect(style.sources.offline.tiles[0]).toContain("/tiles/{z}/{x}/{y}.pbf");
    expect(style.sources.offline.bounds).toEqual([116.85, 4.2, 126.9, 21.35]);
    expect(style.layers.some((layer) => layer.id === "streets")).toBe(true);
    expect(style.layers.some((layer) => layer.id === "buildings")).toBe(true);
    expect(style.layers.some((layer) => layer.id === "pois")).toBe(true);
    expect(style.layers.some((layer) => layer.id === "place-labels")).toBe(false);
    expect(style.layers.some((layer) => layer.id === "street-labels")).toBe(false);
    expect(style.layers.some((layer) => layer.id === "water-polygons-labels")).toBe(false);
  });

  it("can build a label-enabled vector style when a glyph URL is provided", () => {
    const style = buildShortbreadVectorStyle({
      host: "http://127.0.0.1:38000",
      bounds: [116.85, 4.2, 126.9, 21.35],
      center: [121.774, 12.8797],
      zoom: 5.6,
      glyphsUrl: "http://127.0.0.1:38000/glyphs/{fontstack}/{range}.pbf"
    });

    expect(style.glyphs).toContain("/glyphs/{fontstack}/{range}.pbf");
    expect(style.layers.some((layer) => layer.id === "place-labels")).toBe(true);
    expect(style.layers.some((layer) => layer.id === "street-labels")).toBe(true);
    expect(style.layers.some((layer) => layer.id === "water-polygons-labels")).toBe(true);
  });

  it("builds philippines offline fallback style", () => {
    const style = buildOnlineFallbackStyle([121.1, 14.2], 6, [117.5, 5.0, 126.0, 20.0]);
    expect(style.version).toBe(8);
    expect(style.center).toEqual([121.1, 14.2]);
    expect(style.zoom).toBe(6);
    expect(style.sources.landmass.type).toBe("geojson");
    expect(style.sources.referenceCities.type).toBe("geojson");
    expect(style.layers.some((layer) => layer.id === "reference-cities")).toBe(true);
    expect(style.layers.some((layer) => layer.id === "scope-frame")).toBe(true);
  });
});
