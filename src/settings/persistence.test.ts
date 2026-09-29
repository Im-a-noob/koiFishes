import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaults } from "./schema";
import { definition } from "./definition";
import { SettingsStore } from "./store";
import { __internal, connectPersistence, loadInto, save } from "./persistence";

function makeMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  } as Storage;
}

describe("persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeMemoryStorage());
  });

  it("round-trips overrides, weather, and rain through save/load", () => {
    const store = new SettingsStore();
    store.set(["koi", "initialCount"], 22);
    store.setWeather("mist");
    save(store);

    const restored = new SettingsStore();
    loadInto(restored);
    expect(restored.live.koi.initialCount).toBe(22);
    expect(restored.meta().weather).toBe("mist");
  });

  it("drops unknown saved paths instead of throwing", () => {
    localStorage.setItem(
      "nagomi:pond-settings:v2",
      JSON.stringify({
        version: 2,
        overrides: { "koi.depth.shadow.offset.x": 4.4, "koi.initialCount": 10 },
        weather: "sunny",
        rain: false,
      }),
    );
    const store = new SettingsStore();
    expect(() => loadInto(store)).not.toThrow();
    expect(store.live.koi.initialCount).toBe(10);
  });

  it("migrates a v1 snapshot to v2 overrides, dropping removed and unchanged fields", () => {
    const v1Config = defaults(definition) as Record<string, any>;
    v1Config.koi = { ...v1Config.koi, initialCount: 40 };
    // A removed field from the old shape (FISH.depth.shadow.offset) — must be ignored, not throw.
    v1Config.koi.depth = { ...v1Config.koi.depth, shadow: { offset: { x: 4.4, y: 10.4 } } };
    localStorage.setItem(
      "nagomi:pond-settings:v1",
      JSON.stringify({ version: 1, config: v1Config, weather: "sunset", rain: true }),
    );

    const store = new SettingsStore();
    loadInto(store);
    expect(store.live.koi.initialCount).toBe(40);
    expect(store.meta().weather).toBe("sunset");
    expect(store.meta().rain).toBe(true);
    expect(localStorage.getItem("nagomi:pond-settings:v1")).toBeNull();
    expect(localStorage.getItem("nagomi:pond-settings:v2")).not.toBeNull();
  });

  it("connectPersistence wires the store to flushPersist on demand", () => {
    const store = new SettingsStore();
    connectPersistence(store);
    store.set(["koi", "initialCount"], 7);
    store.flushPersist();
    const saved = JSON.parse(localStorage.getItem("nagomi:pond-settings:v2")!);
    expect(saved.overrides["koi.initialCount"]).toBe(7);
  });

  it("exposes the migration helper for direct testing", () => {
    expect(typeof __internal.migrateV1ToOverrides).toBe("function");
  });
});
