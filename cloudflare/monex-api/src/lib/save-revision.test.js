import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";

function makeKv() {
  const store = new Map();
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

function payload(overrides = {}) {
  return buildSavePayload(
    {
      money: 5000,
      monballs: 10,
      updatedAt: new Date().toISOString(),
      ...overrides,
    },
    { username: "tester" }
  );
}

describe("save revision optimistic locking", () => {
  it("first write gets revision 1 and increments monotonically", async () => {
    const kv = makeKv();
    const first = await writeCloudSave(kv, "u1", payload());
    assert.equal(first.revision, 1);
    const second = await writeCloudSave(kv, "u1", payload({ money: 4000 }), { skipStaleCheck: true });
    assert.equal(second.revision, 2);
    const { save } = await loadCloudSave(kv, "u1");
    assert.equal(save.revision, 2);
    assert.equal(save.money, 4000);
  });

  it("accepts a write with matching expectedRevision", async () => {
    const kv = makeKv();
    await writeCloudSave(kv, "u1", payload());
    const next = await writeCloudSave(kv, "u1", payload({ money: 4000 }), { expectedRevision: 1 });
    assert.equal(next.revision, 2);
  });

  it("rejects a stale write with old expectedRevision (no rollback)", async () => {
    const kv = makeKv();
    await writeCloudSave(kv, "u1", payload({ money: 5000 })); // rev 1
    await writeCloudSave(kv, "u1", payload({ money: 2000 }), { expectedRevision: 1 }); // rev 2 (spent money)

    // Stale session still thinks revision is 1 and tries to restore money.
    await assert.rejects(
      () => writeCloudSave(kv, "u1", payload({ money: 5000 }), { expectedRevision: 1 }),
      (err) => {
        assert.equal(err.code, "revision_conflict");
        assert.equal(err.currentRevision, 2);
        assert.equal(err.existingSave.money, 2000);
        return true;
      }
    );

    const { save } = await loadCloudSave(kv, "u1");
    assert.equal(save.money, 2000, "newer progress must not be rolled back");
    assert.equal(save.revision, 2);
  });

  it("rejects stale writes even with a fabricated newer updatedAt", async () => {
    const kv = makeKv();
    await writeCloudSave(kv, "u1", payload({ money: 5000 }));
    await writeCloudSave(kv, "u1", payload({ money: 2000 }), { expectedRevision: 1 });

    const fabricated = payload({
      money: 5000,
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await assert.rejects(
      () => writeCloudSave(kv, "u1", fabricated, { expectedRevision: 1 }),
      (err) => err.code === "revision_conflict"
    );
  });

  it("server-internal writes (skipStaleCheck) still increment revision", async () => {
    const kv = makeKv();
    await writeCloudSave(kv, "u1", payload()); // rev 1
    const internal = await writeCloudSave(kv, "u1", payload({ monballs: 15 }), { skipStaleCheck: true }); // rev 2
    assert.equal(internal.revision, 2);

    // Client on rev 1 now conflicts and must rehydrate.
    await assert.rejects(
      () => writeCloudSave(kv, "u1", payload(), { expectedRevision: 1 }),
      (err) => err.code === "revision_conflict" && err.currentRevision === 2
    );
  });

  it("legacy clients without baseRevision still blocked by updatedAt stale check", async () => {
    const kv = makeKv();
    const now = Date.now();
    await writeCloudSave(kv, "u1", payload({ updatedAt: new Date(now).toISOString() }));
    await assert.rejects(
      () => writeCloudSave(kv, "u1", payload({ updatedAt: new Date(now - 60_000).toISOString() })),
      (err) => err.code === "stale_save"
    );
  });

  it("expectedRevision on first write (no existing save) is accepted", async () => {
    const kv = makeKv();
    const first = await writeCloudSave(kv, "u1", payload(), { expectedRevision: 0 });
    assert.equal(first.revision, 1);
  });

  it("revision survives load/sanitize round trip", async () => {
    const kv = makeKv();
    await writeCloudSave(kv, "u1", payload());
    await writeCloudSave(kv, "u1", payload(), { skipStaleCheck: true });
    await writeCloudSave(kv, "u1", payload(), { skipStaleCheck: true });
    const { save } = await loadCloudSave(kv, "u1");
    assert.equal(save.revision, 3);
  });
});
