import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { brandCssTokens, DEFAULT_BRAND, TENANT_BRAND_UPDATED_EVENT } from "@/lib/tenant-brand";

const eventName = "bealpha:tenant-brand-updated";
const original = { ...DEFAULT_BRAND, displayName: "Original", version: 1 };
const updated = { ...original, displayName: "Updated", version: 2 };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

// Execute the actual provider effect with lightweight hook/API doubles, no DOM/server.
function mount(apiRequest: jest.Mock) {
  const effects: Array<() => (() => void) | void> = [];
  const setBrand = jest.fn();
  const events = new EventTarget();
  const fixtureModule = { exports: {} as { BrandProvider: (props: { children: null }) => unknown } };
  const react = { createContext: () => ({ Provider: "fixture" }), useState: () => [DEFAULT_BRAND, setBrand], useEffect: (effect: () => (() => void) | void) => effects.push(effect), useContext: () => DEFAULT_BRAND };
  const source = readFileSync(process.env.BRAND_PROVIDER_TEST_SOURCE ?? resolve(process.cwd(), "components/layout/BrandProvider.tsx"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const requireFixture = (name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: () => null };
    if (name === "@/lib/api-client") return { apiRequest };
    if (name === "@/lib/tenant-brand") return { DEFAULT_BRAND, brandCssTokens, TENANT_BRAND_UPDATED_EVENT: eventName };
    throw new Error(`Unexpected provider dependency: ${name}`);
  };
  new Function("require", "module", "exports", "window", code)(requireFixture, fixtureModule, fixtureModule.exports, events);
  fixtureModule.exports.BrandProvider({ children: null });
  const cleanup = effects[0]();
  return { setBrand, events, cleanup: () => cleanup?.() };
}

describe("brand provider saved-state refresh", () => {
  it("signals only the persisted save result and keeps the event name shared", () => {
    const source = readFileSync(resolve(process.cwd(), "components/settings/BrandTab.tsx"), "utf8");
    expect(TENANT_BRAND_UPDATED_EVENT).toBe(eventName);
    const saved = source.indexOf("setBrand(updated)");
    const signal = source.indexOf("window.dispatchEvent(new Event(TENANT_BRAND_UPDATED_EVENT))");
    expect(signal).toBeGreaterThan(saved);
    expect(signal).toBeLessThan(source.indexOf("} catch", saved));
  });
  it("reloads the authorized brand after a successful save signal", async () => {
    const api = jest.fn().mockResolvedValue(original);
    const state = mount(api);
    await settle();
    api.mockResolvedValue(updated);
    state.events.dispatchEvent(new Event(eventName));
    await settle();
    expect(api).toHaveBeenCalledTimes(2);
    expect(state.setBrand).toHaveBeenLastCalledWith(updated);
    state.cleanup();
  });

  it("does not let an older pending load overwrite the refreshed brand", async () => {
    let finish!: (value: typeof original) => void;
    const api = jest.fn().mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue(updated);
    const state = mount(api);
    state.events.dispatchEvent(new Event(eventName));
    await settle();
    finish(original);
    await settle();
    expect(state.setBrand).toHaveBeenLastCalledWith(updated);
    state.cleanup();
  });

  it("removes the listener and ignores pending responses on unmount", async () => {
    let finish!: (value: typeof original) => void;
    const api = jest.fn().mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const state = mount(api);
    state.cleanup();
    state.events.dispatchEvent(new Event(eventName));
    finish(original);
    await settle();
    expect(api).toHaveBeenCalledTimes(1);
    expect(state.setBrand).not.toHaveBeenCalled();
  });

  it("keeps the existing brand during a transient refresh failure", async () => {
    const api = jest.fn().mockResolvedValueOnce(original).mockRejectedValue(new Error("fixture unavailable"));
    const state = mount(api);
    await settle();
    state.events.dispatchEvent(new Event(eventName));
    await settle();
    expect(api).toHaveBeenCalledTimes(2);
    expect(state.setBrand).toHaveBeenLastCalledWith(original);
    state.cleanup();
  });
});
