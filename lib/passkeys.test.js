const test = require("node:test");
const assert = require("node:assert/strict");
const { isoBase64URL } = require("@simplewebauthn/server/helpers");
const {
  webAuthnCredentialFromPasskey,
  isStoredPasskeyValid,
  passkeyNeedsReregister,
} = require("./passkeys");

test("webAuthnCredentialFromPasskey matches SimpleWebAuthn v13 shape", () => {
  const idBytes = new Uint8Array([5, 6, 7, 8]);
  const pkBytes = new Uint8Array([1, 2, 3, 4, 5]);
  const stored = {
    credentialID: isoBase64URL.fromBuffer(idBytes),
    credentialPublicKey: isoBase64URL.fromBuffer(pkBytes),
    counter: 0,
    transports: ["internal"],
  };
  assert.equal(isStoredPasskeyValid(stored), true);
  const cred = webAuthnCredentialFromPasskey(stored);
  assert.ok(cred);
  assert.equal(typeof cred.id, "string");
  assert.ok(cred.publicKey instanceof Uint8Array);
  assert.equal(cred.counter, 0);
  assert.equal(cred.credentialID, undefined);
  assert.equal(cred.credentialPublicKey, undefined);
});

test("passkeyNeedsReregister when public key missing", () => {
  const bad = {
    credentialID: isoBase64URL.fromBuffer(new Uint8Array([1])),
    credentialPublicKey: "",
    counter: 0,
  };
  assert.equal(passkeyNeedsReregister(bad), true);
  assert.equal(webAuthnCredentialFromPasskey(bad), null);
});

test("counter defaults to 0 when missing", () => {
  const stored = {
    credentialID: isoBase64URL.fromBuffer(new Uint8Array([9])),
    credentialPublicKey: isoBase64URL.fromBuffer(new Uint8Array([2, 3])),
    transports: [],
  };
  const cred = webAuthnCredentialFromPasskey(stored);
  assert.ok(cred);
  assert.equal(cred.counter, 0);
});
