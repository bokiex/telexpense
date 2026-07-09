import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PendingButton } from "../components/PendingButton";

test("pending button exposes accessible busy state and preserves its label for sizing", () => {
  const html = renderToStaticMarkup(React.createElement(
    PendingButton,
    { pending: true, pendingLabel: "Saving…", type: "submit" },
    "Save Account"
  ));

  assert.match(html, /aria-busy="true"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /role="status"/);
  assert.match(html, /Saving…/);
  assert.match(html, /Save Account/);
  assert.match(html, /brand-loader/);
});

test("idle button is enabled and does not announce a pending status", () => {
  const html = renderToStaticMarkup(React.createElement(
    PendingButton,
    { pendingLabel: "Deleting…" },
    "Delete"
  ));

  assert.match(html, /aria-busy="false"/);
  assert.doesNotMatch(html, /disabled=""/);
  assert.doesNotMatch(html, /Deleting…/);
});
