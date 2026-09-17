import assert from "node:assert/strict";
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
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="([^"]+)"/);
  assert.match(html, /<h2 id="[^"]+">Add Account<\/h2>/);
  assert.match(html, /aria-label="Close"/);
});
