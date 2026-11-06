import { describe, it, expect } from "vitest";
import { drawerReducer, isCloseSwipe, isDrawer, keyboardInset, layoutFor, photoDecodeError } from "../responsive";

describe("layoutFor", () => {
  it("splits at 768 and 1200", () => {
    expect([360, 767, 768, 1199, 1200, 1440].map(layoutFor)).toEqual(["phone", "phone", "tablet", "tablet", "desktop", "desktop"]);
  });
});

describe("drawers", () => {
  it("phones have both drawers, tablets only agents, desktop none", () => {
    expect(isDrawer("nav", "phone")).toBe(true);
    expect(isDrawer("agents", "phone")).toBe(true);
    expect(isDrawer("nav", "tablet")).toBe(false);
    expect(isDrawer("agents", "tablet")).toBe(true);
    expect(isDrawer("agents", "desktop")).toBe(false);
  });
  it("one drawer at a time; toggling closes; close closes", () => {
    expect(drawerReducer("none", { type: "toggle", drawer: "nav" })).toBe("nav");
    expect(drawerReducer("nav", { type: "toggle", drawer: "nav" })).toBe("none");
    expect(drawerReducer("nav", { type: "toggle", drawer: "agents" })).toBe("agents");
    expect(drawerReducer("agents", { type: "close" })).toBe("none");
  });
  it("widening the window drops a drawer that became a normal pane", () => {
    expect(drawerReducer("nav", { type: "resize", width: 900 })).toBe("none");
    expect(drawerReducer("agents", { type: "resize", width: 900 })).toBe("agents");
    expect(drawerReducer("agents", { type: "resize", width: 1300 })).toBe("none");
    expect(drawerReducer("nav", { type: "resize", width: 360 })).toBe("nav");
  });
  it("swipes close towards the drawer's own edge", () => {
    expect(isCloseSwipe("nav", -80, 10)).toBe(true);
    expect(isCloseSwipe("nav", 80, 10)).toBe(false);
    expect(isCloseSwipe("agents", 80, 10)).toBe(true);
    expect(isCloseSwipe("agents", -80, 10)).toBe(false);
    expect(isCloseSwipe("nav", -40, 0)).toBe(false);
    expect(isCloseSwipe("nav", -80, 120)).toBe(false); // scrolling the list
    expect(isCloseSwipe("none", -200, 0)).toBe(false);
  });
});

describe("keyboardInset", () => {
  it("is what the keyboard covers, never negative", () => {
    expect(keyboardInset(800, { height: 500, offsetTop: 0 })).toBe(300);
    expect(keyboardInset(800, { height: 500, offsetTop: 40 })).toBe(260);
    expect(keyboardInset(800, { height: 800, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(500, { height: 800, offsetTop: 0 })).toBe(0);
  });
});

describe("photoDecodeError", () => {
  it("names HEIC when that's the problem, by type or file name", () => {
    expect(photoDecodeError({ type: "image/heic" })).toMatch(/HEIC.*JPEG/);
    expect(photoDecodeError({ type: "image/heif" })).toMatch(/HEIC/);
    expect(photoDecodeError({ type: "", name: "IMG_0001.HEIC" })).toMatch(/HEIC/);
    expect(photoDecodeError({ type: "image/bmp", name: "x.bmp" })).toMatch(/JPEG or PNG/);
  });
});
