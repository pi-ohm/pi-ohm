## JS/TS API (library)

```bash
bun add tuistory    # or npm install tuistory
```

```ts
import { launchTerminal } from "tuistory";

const session = await launchTerminal({
  command: "my-cli",
  args: ["--flag"],
  cols: 120,
  rows: 36,
  cwd: "/path/to/dir",
  env: { MY_VAR: "value" },
});

// observe
const text = await session.text(); // full terminal text
const text = await session.text({ trimEnd: true }); // trimmed
const bold = await session.text({ only: { bold: true } }); // style filter

// act
await session.type("hello world"); // type character by character
await session.press("enter"); // single key
await session.press(["ctrl", "c"]); // key chord
await session.click("Submit"); // click on text

// wait
await session.waitForText("Ready", { timeout: 10000 });
await session.waitForText(/Loading\.\.\./, { timeout: 5000 });

// screenshot to image
const data = session.getTerminalData();
const { renderTerminalToImage } = await import("ghostty-opentui/image");
const image = await renderTerminalToImage(data, { format: "jpeg", devicePixelRatio: 2 });

// cleanup
session.close();
```

## Writing tests with vitest

tuistory is like Playwright but for CLIs. The workflow is: **observe** (snapshot with inline snapshot), **act** (type/press/click), **observe** again. Build tests progressively.

### Step 1: Launch and observe

Start with an empty inline snapshot. Run with `--update` / `-u` to fill it in.

```ts
import { test, expect } from "vitest";
import { launchTerminal } from "tuistory";

test("my CLI shows help", async () => {
  const session = await launchTerminal({
    command: "my-cli",
    args: ["--help"],
    cols: 120,
    rows: 36,
  });

  const text = await session.text({ trimEnd: true });
  expect(text).toMatchInlineSnapshot();
  // ^ run `vitest --run -u` to fill this in, then read the file to see what it captured

  session.close();
}, 10000);
```

### Step 2: Interact and observe again

Add actions and more snapshots incrementally:

```ts
test("bash interaction", async () => {
  const session = await launchTerminal({
    command: "bash",
    args: ["--norc", "--noprofile"],
    cols: 60,
    rows: 10,
    env: { PS1: "$ ", HOME: "/tmp", PATH: process.env.PATH },
  });

  // observe initial state
  const initial = await session.text({ trimEnd: true });
  expect(initial).toMatchInlineSnapshot();

  // act
  await session.type('echo "hello world"');
  await session.press("enter");

  // wait + observe
  const output = await session.waitForText("hello world");
  expect(output).toMatchInlineSnapshot();

  // cleanup
  await session.type("exit");
  await session.press("enter");
  session.close();
}, 10000);
```

### Step 3: Run with -u, read back, iterate

```bash
# fill in snapshots
vitest --run -u

# read the test file to see captured terminal output
# adjust assertions, add more interactions, repeat
```

This observe-act-observe loop lets you progressively explore any TUI. Each inline snapshot captures the exact terminal state, making tests readable and easy to update.

### Testing a TUI app (e.g. opencode, claude)

```ts
test("opencode shows welcome", async () => {
  const session = await launchTerminal({
    command: "opencode",
    cols: 150,
    rows: 45,
  });

  await session.waitForText("switch agent", { timeout: 15000 });
  await session.type("hello from tuistory");

  const text = await session.text({ timeout: 1000 });
  expect(text).toMatchInlineSnapshot();

  // navigate menus
  await session.press(["ctrl", "p"]);
  const commands = await session.waitForText("Commands", { timeout: 5000 });
  expect(commands).toMatchInlineSnapshot();

  await session.press("esc");
  session.close();
}, 30000);
```

### Testing a Node.js debugger

```ts
test("node debugger inspect variables", async () => {
  const session = await launchTerminal({
    command: "node",
    args: ["inspect", "app.js"],
    cols: 150,
    rows: 45,
  });

  await session.waitForText("Break on start", { timeout: 10000 });
  await session.type("cont");
  await session.press("enter");
  await session.waitForText("break in", { timeout: 5000 });

  const snapshot = await session.text({ trimEnd: true });
  expect(snapshot).toMatchInlineSnapshot();

  session.close();
}, 30000);
```
