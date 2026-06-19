import assert from "node:assert/strict";
import test from "node:test";
import {
  setOhmInputStatus,
  type OhmInputStatusEditorFactory,
  type OhmInputStatusInput,
  type OhmInputStatusOptions,
} from "../input-status";

function defineTest(name: string, run: () => void): void {
  void test(name, run);
}

defineTest("setOhmInputStatus installs shared editor header in TUI mode", () => {
  const footerCalls: Array<{ key: string; text: string | undefined }> = [];
  const factories: OhmInputStatusEditorFactory[] = [];
  const calls: Array<{
    key: string;
    text: string | undefined;
    options: OhmInputStatusOptions | undefined;
  }> = [];
  const input: OhmInputStatusInput = {
    key: "ohm-goal",
    text: "Pursuing goal (34s)",
    priority: 20,
  };

  setOhmInputStatus(
    {
      hasUI: true,
      mode: "tui",
      ui: {
        setStatus: (key, text) => {
          footerCalls.push({ key, text });
        },
        setInputStatus: (key, text, options) => {
          calls.push({ key, text, options });
        },
        setEditorComponent: (factory) => {
          if (factory !== undefined) factories.push(factory);
        },
        getEditorComponent: () => factories.at(-1),
      },
    },
    input,
  );

  assert.equal(factories.length, 1);
  assert.deepEqual(calls, []);
  assert.deepEqual(footerCalls, [{ key: "ohm-goal", text: undefined }]);
});

defineTest("setOhmInputStatus uses native input status when editor header is unavailable", () => {
  const calls: Array<{
    key: string;
    text: string | undefined;
    options: OhmInputStatusOptions | undefined;
  }> = [];

  setOhmInputStatus(
    {
      hasUI: true,
      mode: "tui",
      ui: {
        setStatus: () => {
          assert.fail("footer status should not be used when input status is available");
        },
        setInputStatus: (key, text, options) => {
          calls.push({ key, text, options });
        },
      },
    },
    {
      key: "ohm-goal",
      text: "Pursuing goal (34s)",
      priority: 20,
    },
  );

  assert.deepEqual(calls, [
    {
      key: "ohm-goal",
      text: "Pursuing goal (34s)",
      options: { priority: 20 },
    },
  ]);
});

defineTest("setOhmInputStatus falls back to footer status without input support", () => {
  const calls: Array<{ key: string; text: string | undefined }> = [];

  setOhmInputStatus(
    {
      hasUI: true,
      mode: "tui",
      ui: {
        setStatus: (key, text) => {
          calls.push({ key, text });
        },
      },
    },
    {
      key: "ohm-mode",
      text: "smart",
      footerText: "mode:smart",
      priority: 10,
    },
  );

  assert.deepEqual(calls, [{ key: "ohm-mode", text: "mode:smart" }]);
});

defineTest("setOhmInputStatus uses footer status outside TUI mode", () => {
  const footerCalls: Array<{ key: string; text: string | undefined }> = [];
  const inputCalls: Array<{ key: string; text: string | undefined }> = [];

  setOhmInputStatus(
    {
      hasUI: true,
      mode: "rpc",
      ui: {
        setStatus: (key, text) => {
          footerCalls.push({ key, text });
        },
        setInputStatus: (key, text) => {
          inputCalls.push({ key, text });
        },
      },
    },
    {
      key: "ohm-goal",
      text: "Pursuing goal (34s)",
    },
  );

  assert.deepEqual(inputCalls, []);
  assert.deepEqual(footerCalls, [{ key: "ohm-goal", text: "Pursuing goal (34s)" }]);
});

defineTest("setOhmInputStatus clears fallback footer status", () => {
  const calls: Array<{ key: string; text: string | undefined }> = [];

  setOhmInputStatus(
    {
      hasUI: true,
      mode: "print",
      ui: {
        setStatus: (key, text) => {
          calls.push({ key, text });
        },
      },
    },
    {
      key: "ohm-goal",
      text: undefined,
      footerText: "ignored",
    },
  );

  assert.deepEqual(calls, [{ key: "ohm-goal", text: undefined }]);
});

defineTest("setOhmInputStatus ignores contexts without UI", () => {
  setOhmInputStatus(
    {
      hasUI: false,
      mode: "tui",
      ui: {
        setStatus: () => {
          assert.fail("status should not be set without UI");
        },
        setInputStatus: () => {
          assert.fail("input status should not be set without UI");
        },
      },
    },
    {
      key: "ohm-goal",
      text: "Pursuing goal (34s)",
    },
  );
});
