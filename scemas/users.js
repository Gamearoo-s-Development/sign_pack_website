const RateLimit = require("express-rate-limit");
const mongoose = require("mongoose");

const PasskeySchema = new mongoose.Schema(
  {
    credentialID: { type: String, required: true, trim: true },
    credentialPublicKey: { type: String, required: true },
    counter: { type: Number, default: 0 },
    transports: { type: [String], default: [] },
    name: { type: String, default: "Passkey" },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: null },
  },
  { _id: false, strict: true }
);

const PrefixSchema = new mongoose.Schema({
	_id: String, // email
	name: String, //username/name
    password: String,
    CurrentOTT: {
        type: String,
        default: ""
    },
    Loggedin: {
        type: Boolean,
        default: false
    },
    discordId: {
        type: String,
        default: null
      },
      discordTag: {
        type: String,
        default: null
      },
      resetToken: String,
resetTokenExpiry: Date,
      displayName: {
        type: String,
        default: null
      },
      avatarUrl: {
        type: String,
        default: null
      },
      updatedAt: {
        type: Date,
        default: null
      },
      passkeys: {
        type: [PasskeySchema],
        default: undefined,
      },
    key: String,
    RateLimit: Number
}, {
  strict: true,
  minimize: false,
});

PrefixSchema.index({ "passkeys.credentialID": 1 }, { sparse: true });

const MessageModel = (module.exports = mongoose.model("members", PrefixSchema));
