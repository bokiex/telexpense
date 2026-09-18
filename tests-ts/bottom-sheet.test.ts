import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BottomSheet } from "../components/Dashboard";

test("bottom sheet exposes its accessible dialog contract", () => {
  const html = renderToStaticMarkup(React.createElement(
    BottomSheet,
    { title: "Add Account", onClose: () => {}, children: React.createElement("button", { type: "button" }, "Save") }
  ));

  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-labelledby="[^"]+"/);
  assert.match(html, /<h2[^>]*>Add Account<\/h2>/);
  assert.match(html, /aria-label="Close"/);
});

test("bottom sheet is not nested in an inert app frame", () => {
  const html = renderToStaticMarkup(React.createElement(
    "main",
    { className: "mini-root" },
    React.createElement("section", { className: "phone-frame", inert: true }),
    React.createElement(BottomSheet, { title: "Add Transaction", onClose: () => {}, children: null })
  ));

  assert.match(html, /<section class="phone-frame" inert=""><\/section>/);
  assert.match(html, /class="sheet-backdrop"/);
});

test("bottom sheet is above its input-blocking backdrop", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /\.sheet-backdrop\s*\{[^}]*z-index:\s*50;/);
  assert.match(css, /\.bottom-sheet\s*\{[^}]*z-index:\s*51;/);
});
