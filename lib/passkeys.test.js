const test = require("node:test");
const assert = require("node:assert/strict");
const { isoBase64URL } = require("@simplewebauthn/server/helpers");
const {
  normalizeCredentialId,
  credentialIdsEqual,
  credentialIdFromAuthBody,
} = require("./passkeys");

test("normalizeCredentialId round-trips Uint8Array", () => {
  const raw = new Uint8Array([10, 20, 30, 40, 50]);
  const encoded = isoBase64URL.fromBuffer(raw);
  assert.equal(normalizeCredentialId(raw), encoded);
  assert.equal(normalizeCredentialId(encoded), encoded);
});

test("credentialIdsEqual handles base64 vs base64url padding", () => {
  const raw = new Uint8Array([1, 2, 3]);
  const a = isoBase64URL.fromBuffer(raw);
  assert.ok(credentialIdsEqual(a, a));
});

test("credentialIdFromAuthBody prefers id then rawId", () => {
  const id = isoBase64URL.fromBuffer(new Uint8Array([9, 8, 7]));
  assert.equal(credentialIdFromAuthBody({ id }), id);
  assert.equal(credentialIdFromAuthBody({ rawId: id }), id);
});
