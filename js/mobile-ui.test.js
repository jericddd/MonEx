import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.dirname(fileURLToPath(import.meta.url));
const mobileUiPath = path.join(root, "mobile-ui.js");

function loadMobileApi(mockWindow) {
  const code = readFileSync(mobileUiPath, "utf8");
  const ctx = {
    window: mockWindow,
    document: mockWindow.document,
    navigator: mockWindow.navigator,
    global: mockWindow,
    globalThis: mockWindow,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(code, ctx);
  return mockWindow.MonExMobile;
}

function mockMatchMedia(rules) {
  return (query) => ({
    matches: !!rules[query],
    addEventListener() {},
    addListener() {},
  });
}

describe("mobile-ui device detection", () => {
  it("classifies narrow portrait phones as mobile", () => {
    const win = {
      innerWidth: 390,
      innerHeight: 844,
      navigator: { userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5 },
      matchMedia: mockMatchMedia({
        "(max-width: 720px)": true,
        "(hover: none) and (pointer: coarse)": true,
      }),
      document: {
        documentElement: { classList: { add() {}, remove() {}, toggle() {} }, style: { setProperty() {} } },
        body: { classList: { add() {}, remove() {}, toggle() {} } },
        addEventListener() {},
        querySelectorAll: () => [],
        getElementById: () => null,
      },
      addEventListener() {},
      dispatchEvent() {},
      PointerEvent: function () {},
    };
    const api = loadMobileApi(win);
    const profile = api.detectLayoutMode();
    assert.equal(profile.layout, "mobile");
    assert.equal(profile.platform, "ios");
  });

  it("classifies landscape phones with wide width as mobile", () => {
    const win = {
      innerWidth: 844,
      innerHeight: 390,
      navigator: { userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5 },
      matchMedia: mockMatchMedia({
        "(max-width: 720px)": false,
        "(orientation: landscape) and (max-height: 520px) and (hover: none) and (pointer: coarse)": true,
        "(hover: none) and (pointer: coarse)": true,
      }),
      document: {
        documentElement: { classList: { add() {}, remove() {}, toggle() {} }, style: { setProperty() {} } },
        body: { classList: { add() {}, remove() {}, toggle() {} } },
        addEventListener() {},
        querySelectorAll: () => [],
        getElementById: () => null,
      },
      addEventListener() {},
      dispatchEvent() {},
      PointerEvent: function () {},
    };
    const api = loadMobileApi(win);
    assert.equal(api.detectLayoutMode().layout, "mobile");
  });

  it("keeps desktop mouse users on desktop layout", () => {
    const win = {
      innerWidth: 1440,
      innerHeight: 900,
      navigator: { userAgent: "Windows NT", platform: "Win32", maxTouchPoints: 0 },
      matchMedia: mockMatchMedia({
        "(max-width: 720px)": false,
        "(hover: none) and (pointer: coarse)": false,
      }),
      document: {
        documentElement: { classList: { add() {}, remove() {}, toggle() {} }, style: { setProperty() {} } },
        body: { classList: { add() {}, remove() {}, toggle() {} } },
        addEventListener() {},
        querySelectorAll: () => [],
        getElementById: () => null,
      },
      addEventListener() {},
      dispatchEvent() {},
    };
    const api = loadMobileApi(win);
    assert.equal(api.detectLayoutMode().layout, "desktop");
  });

  it("classifies iPad-width touch devices as tablet", () => {
    const win = {
      innerWidth: 820,
      innerHeight: 1180,
      navigator: { userAgent: "iPad", platform: "MacIntel", maxTouchPoints: 5 },
      matchMedia: mockMatchMedia({
        "(max-width: 720px)": false,
        "(min-width: 721px) and (max-width: 1024px)": true,
        "(hover: none) and (pointer: coarse)": true,
      }),
      document: {
        documentElement: { classList: { add() {}, remove() {}, toggle() {} }, style: { setProperty() {} } },
        body: { classList: { add() {}, remove() {}, toggle() {} } },
        addEventListener() {},
        querySelectorAll: () => [],
        getElementById: () => null,
      },
      addEventListener() {},
      dispatchEvent() {},
      PointerEvent: function () {},
    };
    const api = loadMobileApi(win);
    assert.equal(api.detectLayoutMode().layout, "tablet");
  });
});
