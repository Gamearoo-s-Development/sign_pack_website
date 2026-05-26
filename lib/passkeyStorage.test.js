const test = require("node:test");
const assert = require("node:assert/strict");
const { isoBase64URL } = require("@simplewebauthn/server/helpers");
const { normalizePublicKey } = require("./passkeys");
const { buildPasskeyRecord } = require("./passkeyStorage");

test("buildPasskeyRecord stores base64url id and public key", () => {
  const idBytes = new Uint8Array([11, 22, 33, 44]);
  const pkBytes = new Uint8Array([1, 2, 3, 4, 5]);
  const record = buildPasskeyRecord({
    credentialID: isoBase64URL.fromBuffer(idBytes),
    credentialPublicKey: pkBytes,
    counter: 0,
    transports: ["internal"],
    name: "Test",
  });
  assert.equal(record.credentialID, isoBase64URL.fromBuffer(idBytes));
  assert.equal(record.credentialPublicKey, isoBase64URL.fromBuffer(pkBytes));
  assert.equal(record.counter, 0);
});

test("normalizePublicKey round-trips Uint8Array", () => {
  const pk = new Uint8Array([9, 8, 7, 6]);
  const enc = normalizePublicKey(pk);
  assert.equal(enc, isoBase64URL.fromBuffer(pk));
});
