const RateLimit = require("express-rate-limit");
const mongoose = require("mongoose");

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
      
    key: String,
    RateLimit: Number
});

const MessageModel = (module.exports = mongoose.model("members", PrefixSchema));
