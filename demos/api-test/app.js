/* dotuix API Test Suite — app.js
   Exercises every bridge API method and shows pass/fail inline.
   Each section corresponds to a bridge namespace.
   Run by opening api-test.uix in the desktop viewer.
*/

(async () => {
  const results = document.getElementById("results");
  const summary = document.getElementById("summary");
  let totalPass = 0,
    totalFail = 0,
    totalSkip = 0;

  // ── Rendering helpers ──────────────────────────────────────────────────────

  function section(title, tests) {
    const pass = tests.filter((t) => t.status === "pass").length;
    const fail = tests.filter((t) => t.status === "fail").length;
    const skip = tests.filter((t) => t.status === "skip").length;
    const dominant =
      fail > 0 ? "fail" : skip === tests.length ? "skip" : "pass";

    totalPass += pass;
    totalFail += fail;
    totalSkip += skip;

    const div = document.createElement("div");
    div.className = "section";
    div.innerHTML = `
      <div class="section-header">
        ${title}
        <span class="badge ${dominant}">
          ${pass > 0 ? `${pass} pass` : ""}
          ${fail > 0 ? ` · ${fail} fail` : ""}
          ${skip > 0 ? ` · ${skip} skip` : ""}
        </span>
      </div>
      ${tests
        .map(
          (t) => `
        <div class="test-row ${t.status}">
          <em class="icon">${icons[t.status]}</em>
          <span class="test-name">${t.name}</span>
          ${
            t.detail
              ? `<span class="test-detail">${esc(String(t.detail))}</span>`
              : ""
          }
        </div>
      `,
        )
        .join("")}
    `;
    results.appendChild(div);
  }

  const icons = { pass: "✓", fail: "✗", skip: "–", info: "i" };

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function assert(name, condition, detail = "") {
    return { name, status: condition ? "pass" : "fail", detail };
  }

  function skip(name, reason = "") {
    return { name, status: "skip", detail: reason };
  }

  async function tryRun(name, fn) {
    try {
      return await fn();
    } catch (e) {
      return { name, status: "fail", detail: e.message };
    }
  }

  // ── 1. App metadata ────────────────────────────────────────────────────────

  const metaTests = [];
  try {
    const manifest = await uix.manifest();
    metaTests.push(
      assert("manifest() returns object", typeof manifest === "object"),
    );
    metaTests.push(
      assert("manifest.id is api-test", manifest.id === "com.dotuix.api-test"),
    );
    metaTests.push(
      assert(
        "manifest.permissions has 9",
        Array.isArray(manifest.permissions) &&
          manifest.permissions.length === 9,
      ),
    );
    const ver = uix.viewer.version();
    metaTests.push(
      assert(
        "viewer.version() is string",
        typeof ver === "string" && ver.length > 0,
        ver,
      ),
    );
  } catch (e) {
    metaTests.push({
      name: "manifest / viewer.version",
      status: "fail",
      detail: e.message,
    });
  }
  section("App Metadata", metaTests);

  // ── 2. uix.data.find / get / count ────────────────────────────────────────

  const dataTests = [];
  try {
    const all = await uix.data.find({ type: "product" });
    dataTests.push(assert("find({ type }) returns array", Array.isArray(all)));
    dataTests.push(
      assert(
        "10 seed products present",
        all.length === 10,
        `got ${all.length}`,
      ),
    );

    const limited = await uix.data.find({
      type: "product",
      limit: 3,
      offset: 0,
    });
    dataTests.push(assert("find with limit:3 returns 3", limited.length === 3));

    const paged = await uix.data.find({ type: "product", limit: 3, offset: 3 });
    dataTests.push(
      assert(
        "offset:3 returns different records",
        paged[0]?.id !== limited[0]?.id,
      ),
    );

    const filtered = await uix.data.find({
      type: "product",
      where: { category: "grills" },
    });
    dataTests.push(
      assert(
        "scalar where filters correctly",
        filtered.every((r) => JSON.parse(r.body).category === "grills"),
      ),
    );

    const gt = await uix.data.find({
      type: "product",
      where: { price: { gte: 50 } },
    });
    dataTests.push(
      assert(
        "gte operator works",
        gt.every((r) => JSON.parse(r.body).price >= 50),
        `${gt.length} records`,
      ),
    );

    const inList = await uix.data.find({
      type: "product",
      where: { category: { in: ["grills", "appetizers"] } },
    });
    dataTests.push(
      assert(
        "in operator works",
        inList.length > 0,
        `${inList.length} records`,
      ),
    );

    const likeRes = await uix.data.find({
      type: "product",
      where: { name: { like: "%Rice%" } },
    });
    dataTests.push(
      assert(
        "like operator works",
        likeRes.length > 0,
        `${likeRes.length} records`,
      ),
    );

    const sorted = await uix.data.find({
      type: "product",
      orderBy: [{ field: "price", direction: "asc" }],
    });
    let isSorted = true;
    for (let i = 1; i < sorted.length; i++) {
      if (
        JSON.parse(sorted[i].body).price < JSON.parse(sorted[i - 1].body).price
      ) {
        isSorted = false;
        break;
      }
    }
    dataTests.push(assert("multi-field orderBy sorts correctly", isSorted));

    const rec = await uix.data.get(all[0].id);
    dataTests.push(
      assert("get(id) returns matching record", rec && rec.id === all[0].id),
    );

    const missing = await uix.data.get("product:does-not-exist");
    dataTests.push(assert("get(missing id) returns null", missing === null));

    const count = await uix.data.count({ type: "product" });
    dataTests.push(
      assert(
        "count({ type }) returns number",
        typeof count === "number" && count === 10,
        `${count}`,
      ),
    );

    const filteredCount = await uix.data.count({
      type: "product",
      where: { category: "grills" },
    });
    dataTests.push(
      assert(
        "count with where filter",
        filteredCount <= count,
        `${filteredCount}`,
      ),
    );

    const rawRows = await uix.data.raw(
      "SELECT id FROM records WHERE type = ? LIMIT 2",
      ["product"],
    );
    dataTests.push(
      assert(
        "data.raw executes SELECT",
        Array.isArray(rawRows) && rawRows.length > 0,
      ),
    );
  } catch (e) {
    dataTests.push({ name: "data API", status: "fail", detail: e.message });
  }
  section("uix.data — Read-Only", dataTests);

  // ── 3. uix.state basic ────────────────────────────────────────────────────

  // Clean slate before testing
  try {
    await uix.state.clear();
  } catch (_) {}

  const stateTests = [];
  let insertedId;
  try {
    const r = await uix.state.insert({
      type: "test_item",
      body: { value: 42, label: "hello" },
    });
    insertedId = r.id;
    stateTests.push(
      assert(
        "insert returns record with id",
        r.id && r.type === "test_item",
        r.id,
      ),
    );
    stateTests.push(
      assert("insert body is JSON string", typeof r.body === "string"),
    );
    stateTests.push(
      assert("insert body round-trips", JSON.parse(r.body).value === 42),
    );

    const found = await uix.state.find({ type: "test_item" });
    stateTests.push(
      assert("find after insert returns 1 record", found.length === 1),
    );

    const got = await uix.state.get(r.id);
    stateTests.push(
      assert("get(id) returns the record", got && got.id === r.id),
    );

    const updated = await uix.state.update(r.id, {
      value: 99,
      label: "updated",
    });
    stateTests.push(
      assert("update returns updated record", updated && updated.id === r.id),
    );
    const afterUpdate = await uix.state.get(r.id);
    stateTests.push(
      assert(
        "update changes body value",
        JSON.parse(afterUpdate.body).value === 99,
      ),
    );

    const count = await uix.state.count({ type: "test_item" });
    stateTests.push(assert("count after insert = 1", count === 1, `${count}`));

    await uix.state.delete(r.id);
    const afterDel = await uix.state.get(r.id);
    stateTests.push(assert("delete removes the record", afterDel === null));

    const countAfterDel = await uix.state.count({ type: "test_item" });
    stateTests.push(assert("count after delete = 0", countAfterDel === 0));
  } catch (e) {
    stateTests.push({ name: "state basic", status: "fail", detail: e.message });
  }
  section("uix.state — Basic CRUD", stateTests);

  // ── 4. uix.state advanced ────────────────────────────────────────────────

  const advTests = [];
  try {
    // upsert — insert
    const u1 = await uix.state.upsert({
      id: "settings:main",
      type: "settings",
      body: { theme: "dark" },
    });
    advTests.push(
      assert("upsert inserts new record", u1.id === "settings:main", u1.id),
    );

    // upsert — update
    const u2 = await uix.state.upsert({
      id: "settings:main",
      type: "settings",
      body: { theme: "light" },
    });
    const afterUpsert = await uix.state.get("settings:main");
    advTests.push(
      assert(
        "upsert updates existing record",
        JSON.parse(afterUpsert.body).theme === "light",
      ),
    );

    // insertMany
    const many = await uix.state.insertMany([
      { type: "batch_item", body: { n: 1 } },
      { type: "batch_item", body: { n: 2 } },
      { type: "batch_item", body: { n: 3 } },
    ]);
    advTests.push(assert("insertMany returns 3 records", many.length === 3));
    advTests.push(
      assert(
        "insertMany records have ids",
        many.every((r) => r.id),
      ),
    );

    // purge
    await uix.state.insert({ type: "old_log", body: { msg: "x" } });
    // purge with a zero duration to delete all (olderThan: "0s")
    const purgeCount = await uix.state.purge({
      type: "old_log",
      olderThan: "0s",
    });
    advTests.push(
      assert(
        "purge returns deleted count (number)",
        typeof purgeCount === "number",
      ),
    );

    // transaction
    const txResults = await uix.state.transaction([
      { op: "insert", type: "tx_item", body: { role: "inserted" } },
      { op: "delete", id: "settings:main" },
    ]);
    advTests.push(
      assert(
        "transaction returns array of results",
        Array.isArray(txResults) && txResults.length === 2,
      ),
    );
    advTests.push(
      assert(
        "transaction insert result has id",
        txResults[0] && txResults[0].id,
      ),
    );
    const settingsAfterTx = await uix.state.get("settings:main");
    advTests.push(
      assert("transaction delete removes record", settingsAfterTx === null),
    );

    // clear with type
    const clearCount = await uix.state.clear({ type: "batch_item" });
    advTests.push(
      assert(
        "clear({ type }) returns deleted count",
        typeof clearCount === "number",
        `${clearCount}`,
      ),
    );
    const afterClear = await uix.state.count({ type: "batch_item" });
    advTests.push(
      assert("clear({ type }) removes all of that type", afterClear === 0),
    );

    // clear all
    await uix.state.insert({ type: "temp", body: {} });
    const clearAll = await uix.state.clear();
    advTests.push(
      assert(
        "clear() removes all records",
        typeof clearAll === "number" && clearAll >= 1,
      ),
    );
    const totalAfterClear = await uix.state.count({ type: "temp" });
    advTests.push(assert("clear() leaves 0 records", totalAfterClear === 0));

    // reset
    await uix.state.insert({ type: "before_reset", body: {} });
    await uix.state.reset();
    const afterReset = await uix.state.count({ type: "before_reset" });
    advTests.push(assert("reset() wipes state", afterReset === 0));
  } catch (e) {
    advTests.push({
      name: "state advanced",
      status: "fail",
      detail: e.message,
    });
  }
  section("uix.state — Advanced", advTests);

  // ── 5. uix.state size / vacuum / export ──────────────────────────────────

  const lifecycleTests = [];
  try {
    // Insert some data first
    await uix.state.insertMany(
      Array.from({ length: 20 }, (_, i) => ({
        type: "lifecycle_item",
        body: { i, val: "x".repeat(100) },
      })),
    );

    const sz = await uix.state.size();
    lifecycleTests.push(
      assert(
        "size() returns { bytes, records, types }",
        typeof sz.bytes === "number" &&
          typeof sz.records === "number" &&
          typeof sz.types === "object",
        `${sz.bytes}B / ${sz.records} records`,
      ),
    );
    lifecycleTests.push(assert("size.records >= 20", sz.records >= 20));

    const exported = await uix.state.export({ type: "lifecycle_item" });
    lifecycleTests.push(
      assert("export() returns JSON string", typeof exported === "string"),
    );
    const parsed = JSON.parse(exported);
    lifecycleTests.push(
      assert(
        "export JSON is an array of records",
        Array.isArray(parsed) && parsed.length >= 20,
        `${parsed.length} records`,
      ),
    );

    await uix.state.clear({ type: "lifecycle_item" });

    const vac = await uix.state.vacuum();
    lifecycleTests.push(
      assert(
        "vacuum() returns { before, after }",
        typeof vac.before === "number" && typeof vac.after === "number",
        `${vac.before}B → ${vac.after}B`,
      ),
    );
    lifecycleTests.push(
      assert(
        "vacuum after < vacuum before (or equal)",
        vac.after <= vac.before,
      ),
    );

    const rawState = await uix.state.raw(
      "SELECT COUNT(*) AS n FROM records",
      [],
    );
    lifecycleTests.push(
      assert("state.raw executes SQL", Array.isArray(rawState)),
    );
  } catch (e) {
    lifecycleTests.push({
      name: "lifecycle",
      status: "fail",
      detail: e.message,
    });
  }
  section("uix.state — Size / Vacuum / Export", lifecycleTests);

  // ── 6. OS bridge APIs ─────────────────────────────────────────────────────

  const osTests = [];

  // window.setTitle (no permission needed)
  await tryRun("window.setTitle — sets title", async () => {
    await uix.window.setTitle("API Test ✓");
    return {
      name: "window.setTitle() completes without error",
      status: "pass",
      detail: "",
    };
  }).then((r) => osTests.push(r));

  // clipboard.write
  try {
    await uix.clipboard.write("dotuix clipboard test");
    osTests.push(assert("clipboard.write() resolves", true));
  } catch (e) {
    osTests.push({
      name: "clipboard.write()",
      status: "fail",
      detail: e.message,
    });
  }

  // fullscreen.enter / exit
  try {
    await uix.fullscreen.enter();
    await uix.fullscreen.exit();
    osTests.push(assert("fullscreen.enter() + exit() resolve", true));
  } catch (e) {
    osTests.push({
      name: "fullscreen.enter/exit()",
      status: "fail",
      detail: e.message,
    });
  }

  // notify
  try {
    await uix.notify("API Test", "Notification test from api-test.uix");
    osTests.push(assert("notify() resolves", true));
  } catch (e) {
    osTests.push({ name: "uix.notify()", status: "fail", detail: e.message });
  }

  // file.save — just test the call; user can cancel
  osTests.push(
    skip("file.save()", "requires user interaction — test manually"),
  );
  osTests.push(
    skip("file.open()", "requires user interaction — test manually"),
  );
  osTests.push(
    skip("browser.open()", "requires user interaction — test manually"),
  );

  section("OS Bridge", osTests);

  // ── Final summary ─────────────────────────────────────────────────────────

  summary.textContent =
    `${totalPass + totalFail + totalSkip} tests · ` +
    `${totalPass} passed · ${totalFail} failed · ${totalSkip} skipped`;
  summary.style.color = totalFail > 0 ? "#f85149" : "#3fb950";

  // ── Footer buttons ────────────────────────────────────────────────────────

  document
    .getElementById("btn-reset-state")
    .addEventListener("click", async () => {
      await uix.state.reset();
      alert("State DB reset. Reload to re-run tests.");
    });

  document
    .getElementById("btn-print")
    .addEventListener("click", () => uix.print());
})();
