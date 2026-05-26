const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

function toBuffer(base64url) {
  return Buffer.from(String(base64url || ""), "base64url");
}

function toBase64Url(buf) {
  if (!buf) return "";
  return Buffer.from(buf).toString("base64url");
}

function publicPasskey(passkey) {
  return {
    credentialID: passkey.credentialID,
    transports: Array.isArray(passkey.transports) ? passkey.transports : [],
    name: passkey.name || "Passkey",
    createdAt: passkey.createdAt || null,
    lastUsedAt: passkey.lastUsedAt || null,
  };
}

async function registrationOptions(user, webauthn) {
  const excludeCredentials = Array.isArray(user.passkeys)
    ? user.passkeys.map((p) => ({
        id: p.credentialID,
        type: "public-key",
        transports: Array.isArray(p.transports) ? p.transports : [],
      }))
    : [];

  return generateRegistrationOptions({
    rpName: webauthn.rpName,
    rpID: webauthn.rpID,
    userName: String(user._id),
    userDisplayName: String(user.displayName || user.name || user._id),
    userID: Buffer.from(String(user._id)),
    timeout: 60000,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    excludeCredentials,
  });
}

async function verifyRegistration(credential, expectedChallenge, webauthn) {
  return verifyRegistrationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin: webauthn.origin,
    expectedRPID: webauthn.rpID,
    requireUserVerification: false,
  });
}

async function authenticationOptions(allowCredentialIDs, webauthn) {
  const allowCredentials = Array.isArray(allowCredentialIDs)
    ? allowCredentialIDs.map((id) => ({ id, type: "public-key" }))
    : [];

  return generateAuthenticationOptions({
    rpID: webauthn.rpID,
    timeout: 60000,
    userVerification: "preferred",
    allowCredentials,
  });
}

async function verifyAuthentication(credential, expectedChallenge, authenticator, webauthn) {
  return verifyAuthenticationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin: webauthn.origin,
    expectedRPID: webauthn.rpID,
    authenticator,
    requireUserVerification: false,
  });
}

function authenticatorFromPasskey(passkey) {
  return {
    credentialID: toBuffer(passkey.credentialID),
    credentialPublicKey: toBuffer(passkey.credentialPublicKey),
    counter: Number(passkey.counter || 0),
    transports: Array.isArray(passkey.transports) ? passkey.transports : [],
  };
}

module.exports = {
  toBase64Url,
  toBuffer,
  publicPasskey,
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
  authenticatorFromPasskey,
};
