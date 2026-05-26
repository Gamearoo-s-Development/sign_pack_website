const express = require("express");
const multer = require("multer");
const archiver = require("archiver");
const fs = require("fs");
const path = require("path");
const morgan = require("morgan");
const crypto = require("crypto");
const { v4: uuidv4 } = require('uuid');
const mkdirp = require("mkdirp");
const serveIndex = require("serve-index");

const app = express();
const session = require("express-session");
const { dburl, email, domain, discord, ramAi, webauthn } = require("./config");
const { createRamAiRouter } = require("./routes/ramAi");
const { createPasskeyRouter } = require("./routes/passkeys");
const { createAccountRouter } = require("./routes/account");
const { refreshSessionUser, editorUserView, deleteAvatarFile } = require("./lib/userProfile");
const { parseExportOptions, renderTilePng } = require("./lib/multiblockTiles");
const {
  otpEmail,
  resetPasswordEmail,
  passwordChangedEmail,
  accountDeletedEmail,
  welcomeEmail,
} = require("./lib/emailTemplates");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const MongoStore = require("connect-mongo");
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.use(session({
  secret: "ycHW1aon4m5uIa",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: dburl }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: "lax",
    secure: false
  }
}));

app.use(passport.initialize());
app.use(passport.session());


app.use(express.json()); // For parsing application/json

app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded

const serveStatic = require("serve-static");



const PORT = 8090;
const username = "username";

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set('trust proxy', true);


app.use(morgan("dev"));
app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"]     // so /app/update resolves to /app/update.html
}));
app.use("/images", express.static(path.join(__dirname, "images")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/signpacks", express.static(path.join(__dirname, "signpacks")));

const { default: mongoose } = require("mongoose");

const { hexToInt: toColorInt } = require("hex-to-int");

const usersDB = require("./scemas/users.js")
const nodemailer = require("nodemailer")

const bcrypt = require("bcryptjs");
mongoose
  .connect(dburl)
  .then(console.log("Mongo Activated.. On API!"));

app.use(express.urlencoded({ extended: true }));
console.log("ready")
function isLoggedIn(req, res, next) {
  if (req.session?.isAuth) return next();
  return res.redirect("/login");
}


const userPath = path.join(__dirname, "users");

process.on("unhandledRejection", console.error);
    process.on("uncaughtException", console.error);
    process.on("uncaughtExceptionMonitor", console.error);


const staticPath = path.join(__dirname, "users");
app.use('/users/:username', isLoggedIn, (req, res, next) => {
  const username = req.params.username;
  if (req.session.user.name !== username) return res.status(403).send("Forbidden");

  const baseDir = path.join(staticPath, username);
  express.static(baseDir)(req, res, (err) => {
    if (err) return next(err);
    serveIndex(baseDir, { icons: true })(req, res, next);
  });
});


// --- App download homepage ---

app.use(createAccountRouter({ usersDB, isLoggedIn, webauthn }));
app.use(createPasskeyRouter({ usersDB, webauthn }));

// --- Delete account (confirm page) ---
app.get("/account/delete", isLoggedIn, (req, res) => {
  res.render("account-delete", {
    user: req.session.user
  });
});

// --- Delete account (action) ---
app.post("/account/delete", isLoggedIn, async (req, res) => {
  try {
    // Simple guard to prevent accidental clicks
    const { confirm } = req.body;
    if (confirm !== "DELETE") {
      return res.status(400).send("You must type DELETE to confirm.");
    }

    const email = req.session.user._id;     // users collection _id
    const username = req.session.user.name; // folder name in /users

    await sendAppMailSafe(email, accountDeletedEmail());

    // 1) Remove user document
    await usersDB.deleteOne({ _id: email });

    // 2) Delete user files: /users/<username>
    const dir = path.join(__dirname, "users", username);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    deleteAvatarFile(email);

    // 3) Destroy session + redirect
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.redirect("/?account_deleted=1");
    });
  } catch (err) {
    console.error("Account delete failed:", err);
    res.status(500).send("Failed to delete account.");
  }
});




const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage, limits: {
    fileSize: 4 * 1024 * 1024 * 1024 // 4 GB in bytes
  } });

app.get("/login", async (req, res) => {
  let args = {
    domain
}

return res.render("login", args)

})



passport.serializeUser((user, done) => {
  done(null, user); // full object
});
passport.deserializeUser((obj, done) => {
  done(null, obj); // no DB fetch needed here
});


app.get("/forgot-password", (req, res) => {
  res.render("forgot-password", { domain });
});


app.post("/forgot-password", async (req, res) => {
  const { email: recipientEmail } = req.body;
  const user = await usersDB.findOne({ _id: recipientEmail });

  if (!user) return res.redirect("/forgot-password?error=notfound");

  const token = crypto.randomBytes(32).toString("hex");
  const expires = Date.now() + 1000 * 60 * 60; // 1 hour

  user.resetToken = token;
  user.resetTokenExpiry = expires;
  await user.save();

  const resetLink = `${domain}/reset/${token}`;
  const mail = resetPasswordEmail(resetLink);

await sendAppMail(recipientEmail, mail);

  res.redirect("/forgot-password?success=sent");
});



app.get("/reset/:token", async (req, res) => {
  const { token } = req.params;
  const user = await usersDB.findOne({
    resetToken: token,
    resetTokenExpiry: { $gt: Date.now() }
  });

  if (!user) return res.redirect("/forgot-password?error=invalid");

  res.render("reset-password", { email: user._id, token });
});


app.post("/reset/:token", async (req, res) => {
  const { token } = req.params;
  const { pass, rpass } = req.body;

  const user = await usersDB.findOne({
    resetToken: token,
    resetTokenExpiry: { $gt: Date.now() }
  });

  if (!user) return res.redirect("/forgot-password?error=expired");

  if (pass !== rpass) return res.redirect(`/reset/${token}?error=nomatch`);

  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(pass, salt);

  user.password = hashed;
  user.resetToken = null;
  user.resetTokenExpiry = null;
  await user.save();

  await sendAppMailSafe(user._id, passwordChangedEmail());

  res.redirect("/login?reset=success");
});


// Log in to RPC with client id


passport.use(new DiscordStrategy({
  clientID: discord.clientId,
  clientSecret: discord.clientSecret,
  callbackURL: `${domain}/auth/discord/login/callback`,
  scope: ['identify', 'email'],
  passReqToCallback: true // ✅ enables access to req in callback
}, async (req, accessToken, refreshToken, profile, done) => {
  return res.redirect("/login");
  try {
    const discordEmail = profile.email;
    const discordId = profile.id;
    const discordTag = `${profile.username}#${profile.discriminator}`;

    // ✅ Use logged-in user's session email if present
    const sessionEmail = req.session?.user?._id;
    const lookupEmail = sessionEmail || discordEmail;

   // const user = await usersDB.findOne({ _id: lookupEmail });
    const user = await usersDB.findOne({ discordId: discordId });

    if (!user) {
      return done(null, {
        _id: discordEmail,
        name: profile.username,
        newUser: true
      });
    }

    // ✅ Update Discord info if not already linked
    user.discordId = discordId;
    user.discordTag = discordTag;
    await user.save();

    return done(null, {
      _id: user._id,
      name: user.name,
      discordId,
      discordTag,
      discriminator: profile.discriminator
    });
  } catch (err) {
    console.error("Discord auth error:", err);
    return done(err, null);
  }
}));


// app.get("/auth/discord/signup", passport.authenticate("discord", {
//   callbackURL: `${domain}/auth/discord/signup/callback`,
//   scope: ['identify', 'email']
// }));

// app.get("/auth/discord/login", passport.authenticate("discord", {
//   callbackURL: `${domain}/auth/discord/login/callback`
// }));

app.get("/auth/discord/login/callback", passport.authenticate("discord", {
  failureRedirect: "/login",
  callbackURL: `${domain}/auth/discord/login/callback`
}), async (req, res) => {
    return res.redirect("/login");
  try {
    // If this was a new account (from signup flow), redirect to complete signup
    //if (req.user.newUser) return res.redirect("/signup");

    // Find the user by Discord ID
    const existing = await usersDB.findOne({ discordId: req.user.discordId });

    // If somehow user is missing, fallback to login page
    if (!existing) {
      console.warn("⚠️ Discord login callback - user not found:", req.user.discordId);
      return res.redirect("/login?error=notfound");
    }

    // Log them in
    req.session.isAuth = true;
    req.session.user = {
      _id: existing._id,
      name: existing.name,
      displayName: existing.displayName || null,
      avatarUrl: existing.avatarUrl || null,
      discord: existing.discordId
    };

    req.session.save(() => res.redirect("/signpack"));
  } catch (err) {
    console.error("❌ Discord login callback error:", err);
    res.redirect("/login?error=discord_callback_failed");
  }
});



app.get("/auth/discord/signup/callback", passport.authenticate("discord", {
  failureRedirect: "/signup",
  callbackURL: `${domain}/auth/discord/signup/callback`
}), async (req, res) => {
    return res.redirect("/login");
  // Check DB again to be sure
  const existing = await usersDB.findOne({ _id: req.user._id });
  if (existing) return res.redirect("/login?exists=true");

  // Save Discord session info for final password step
  req.session.discordSignup = {
    email: req.user._id,
    name: req.user.name,
    discordId: req.user.discordId,
    discordTag: req.user.discordTag
  };
  

  req.session.save(() => {
    res.redirect("/signup/discord-finish");
  });
});



app.get("/signpack/reorder/:packId", isLoggedIn, async (req, res) => {
  const packId = req.params.packId;
  const username = req.session.user.name;

  const signsPath = path.join(__dirname, "users", username, "packs", packId, "signs.json");
  if (!fs.existsSync(signsPath)) return res.status(404).send("Pack not found");

  const signsData = JSON.parse(fs.readFileSync(signsPath, "utf-8"));

  res.render("signpack/reorder", {
    selectedPack: signsData,
    user: req.session.user
  });
});


app.post('/signpack/reorderadvanced/:packId', isLoggedIn, async (req, res) => {
  const { packId } = req.params;
  const { order } = req.body;

  const username = req.session?.user?.name;
  if (!username) {
    console.error("❌ Missing session username");
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  if (!Array.isArray(order)) {
    console.error("❌ Reorder failed: Invalid order format", order);
    return res.status(400).json({ success: false, message: "Invalid order format." });
  }

  const userPackPath = path.join(__dirname, 'users', username, 'packs', packId, 'signs.json');

  if (!fs.existsSync(userPackPath)) {
    console.error("❌ Reorder failed: signs.json not found at", userPackPath);
    return res.status(404).json({ success: false, message: "Pack not found." });
  }

  try {
    const pack = JSON.parse(fs.readFileSync(userPackPath, 'utf-8'));

    if (!Array.isArray(pack.signs)) {
      console.error("❌ Reorder failed: 'signs' is not an array");
      return res.status(400).json({ success: false, message: "Pack data invalid." });
    }

    const idToSignMap = {};
    for (const sign of pack.signs) {
      idToSignMap[sign.id] = sign;
    }

    // Rebuild signs array in new order
    const reorderedSigns = [];
    for (const id of order) {
      const sign = idToSignMap[id];
      if (!sign) {
        console.error(`❌ Reorder failed: Missing sign with ID ${id}`);
        return res.status(400).json({ success: false, message: `Missing sign with ID: ${id}` });
      }
      reorderedSigns.push(sign);
    }

    // Save updated sign order
    pack.signs = reorderedSigns;
    fs.writeFileSync(userPackPath, JSON.stringify(pack, null, 2));

    console.log(`✅ Reordered ${order.length} signs in pack ${packId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Reorder failed:", err);
    res.status(500).json({ success: false, message: "Failed to save order." });
  }
});


app.post("/signpack/delete/:packId/:signId", isLoggedIn, async (req, res) => {
  const { packId, signId } = req.params;
  const username = req.session.user.name;
  const basePath = path.join(__dirname, "users", username, "packs", packId);
  const jsonPath = path.join(basePath, "signs.json");

  if (!fs.existsSync(jsonPath)) return res.status(404).send("Pack not found");

  const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const signIndex = data.signs.findIndex(s => s.id === signId);
  if (signIndex === -1) return res.status(404).send("Sign not found");

  // Remove sign
  data.signs.splice(signIndex, 1);
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));

  res.redirect("/signpack?pack=" + packId);
});


app.get("/auth/discord", passport.authenticate("discord"));

// Callback handler







app.get("/login/ott", async (req, res) => {
  let args = {
    domain
}

return res.render("ott", args)

})



app.get("/signup/discord-finish", async (req, res) => {
  if (!req.session.discordSignup) return res.redirect("/signup");

  const discordData = req.session.discordSignup;

  res.render("discord-finish", {
    domain,
    email: discordData.email,
    name: discordData.name
  });
});





app.post("/signup/discord-finish", async (req, res) => {
  if (!req.session.discordSignup) return res.redirect("/signup");

  const { email, name, pass, rpass } = req.body;
  if (pass !== rpass) return res.redirect("/signup/discord-finish?error=nomatch");

  const existing = await usersDB.findOne({ _id: email });
  if (existing) return res.redirect("/login");

  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(pass, salt);

  const discordData = req.session.discordSignup;

  await usersDB.create({
    _id: email,
    name,
    password: hashed,
    discordId: discordData.discordId,
    discordTag: discordData.discordTag
  });

  req.session.isAuth = true;
  req.session.user = {
    _id: email,
    name,
    displayName: null,
    avatarUrl: null,
    discord: discordData.discordId
  };

  delete req.session.discordSignup;

  await sendAppMailSafe(email, welcomeEmail({ name, loginUrl: `${domain}/login` }));

  res.redirect("/signpack");
});



app.get("/signup", async (req, res) => {
  let args = {
    domain
}

return res.render("signup", args)

})





app.post("/login", async (req, res) => {
  let {name, email, pass} = req.body;

  let user = await usersDB.findOne({_id: email});



  if(!user) return res.redirect("/login");
  let passcheck = await bcrypt.compare(pass, user.password);

  

if(passcheck === false) return res.redirect("/login");


  let hi = await login(email);

  const salt2 = await bcrypt.genSalt(10);
  const secOTT = await bcrypt.hash(`${hi}`, salt2);
  user.CurrentOTT = secOTT;

  
  user.save();
  
  res.redirect("/login/ott")
});

app.post("/ott", async (req, res) => {
  let {code, email} = req.body;
 

 // if(code2 !== code) return res.redirect("/login");

 
  let user = await usersDB.findOne({_id: email});



  if(!user) return res.redirect("/signup");

//if(user.)


if(await bcrypt.compare(code, user.CurrentOTT)) {
  user.CurrentOTT = "‎";

  user.save();
  req.session.isAuth = true;
  req.session.user = {
    _id: email,
    name: user.name,
    displayName: user.displayName || null,
    avatarUrl: user.avatarUrl || null,
    discord: user.discordId
  };
  res.redirect("/signpack")
} else {
  user.CurrentOTT = "‎";
  user.save();
  res.redirect("/login")
}
  

 


})

app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) throw err;
    res.redirect("/");
  });
});



app.post("/signup", async (req, res) => {
  let {name, email, reemail, pass, rpass} = req.body;
console.log(email)
console.log(reemail)

  if(email !== reemail) return res.redirect("/signup");
  if(pass !== rpass) return res.redirect("/signup");

  let user = await usersDB.findOne({_id: email});



  if(user) return res.redirect("/login");


  const salt = await bcrypt.genSalt(10);
  const secPass = await bcrypt.hash(pass, salt);
  let hi = await login(email);
  const salt2 = await bcrypt.genSalt(10);
  const secOTT = await bcrypt.hash(`${hi}`, salt2);





  



  usersDB.create({_id: email, name, password: secPass, CurrentOTT: secOTT});

  res.redirect("/login/ott")


  
});

app.post("/logout", (req, res) => {
  req.session.destroy((err => {
    if(err) throw err;
    res.redirect("/")
  }))
});

let configOptions = {
  host: email.host,
  port: email.port,
  secure: false, 
  auth: {
    user: email.user,
    pass: email.pass
  }
}
const transporter = nodemailer.createTransport(configOptions);

function mailFrom() {
  return email.from || '"Signpack Maker" <no-reply@gamearoo.dev>';
}

async function sendAppMail(to, mail) {
  return transporter.sendMail({
    from: mailFrom(),
    to: String(to),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}

async function sendAppMailSafe(to, mail) {
  try {
    await sendAppMail(to, mail);
  } catch (err) {
    console.error("Email send failed:", err.message);
  }
}

async function login(emailId, name){


  // const html = `
  // <body>
  // <img src="https://gamearoo.top/ram-api-img/ramapiicon.png" />
  // <h1>Your One Time Password For Ram Api</h1>
 
  // <p>Code: 15128</p> 
  // <p>No one from Gamearoo's Development Or Ram Bot Development Teams Will ask you for this code.</p>
  // <p>If You did not request this code you can ignore this email</p>

  // If you have any questions or concerns please feel free to <a href = "mailto: support@rambot.xyz">Reach out to the Ram Bot Development Support Team</a>.



 
  
  // </body> 
  // `
let code = Math.floor(Math.random()*90000) + 10000;;

const mail = otpEmail(code);

await sendAppMail(emailId, mail);


return code;


 
}


app.get("/", (req, res) => {
  const user = req.session?.user; // adjust if you use a custom session var

  if (user && user.name) {
    res.redirect("/signpack");
  } else {
    res.render("home");
  }
});

app.post("/signpack/delete-pack/:packId", isLoggedIn, async (req, res) => {
  const username = req.session.user.name;
  const packId = req.params.packId;
  const baseDir = path.join(__dirname, "users", username, "packs", packId);

  if (!fs.existsSync(baseDir)) {
    return res.status(404).json({ success: false, error: "Pack not found" });
  }

  try {
    fs.rmSync(baseDir, { recursive: true, force: true });
    return res.json({ success: true });
  } catch (err) {
    console.error("Delete pack error:", err);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});

app.get("/signpack/download/:packId", isLoggedIn, async (req, res) => {
  const username = req.session.user.name;
  const packId = req.params.packId;
  const baseDir = path.join(__dirname, "users", username, "packs", packId);
  const signsJsonPath = path.join(baseDir, "signs.json");

  if (!fs.existsSync(baseDir) || !fs.existsSync(signsJsonPath)) {
    return res.status(404).send("Pack not found or missing signs.json.");
  }

  const packData = JSON.parse(fs.readFileSync(signsJsonPath, "utf8"));
  const sanitizedName = (packData.name || "signpack").replace(/[^\w\s-]/g, "").replace(/\s+/g, "_");
  const zipName = `${sanitizedName}.zip`;
  const outputPath = path.join(__dirname, "signpacks", zipName);

  fs.mkdirSync(path.join(__dirname, "signpacks"), { recursive: true });

  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

  const output = fs.createWriteStream(outputPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  output.on("close", () => {
    res.download(outputPath, zipName, (err) => {
      if (err) {
        console.error("Download error:", err);
        return;
      }

      // Clean up the zip and the user's pack folder after download
      try {
        fs.unlinkSync(outputPath);
       // fs.rmSync(baseDir, { recursive: true, force: true });
        //console.log(`Deleted zip and user pack at ${baseDir}`);
       
      } catch (cleanupErr) {
        console.error("Cleanup error:", cleanupErr);
      }
    });

    
  });

  archive.on("error", err => {
    console.error("Zip error:", err);
    res.status(500).send("Could not zip the folder.");
  });

  archive.pipe(output);
  archive.directory(baseDir, false);
  archive.finalize();
});




app.get("/signpack", isLoggedIn, async (req, res) => {
  await refreshSessionUser(req, usersDB);
  const selectedId = req.query.pack;
  const rawIndex = req.query.signIndex;
  const selectedSignIndex = rawIndex ? parseInt(rawIndex) - 1 : null;

  const username = req.session.user.name;
  const packsPath = path.join(userPath, username, "packs");

  let signpacks = [];
  if (fs.existsSync(packsPath)) {
    const folders = fs.readdirSync(packsPath);
    for (const folder of folders) {
      const signsJson = path.join(packsPath, folder, "signs.json");
      if (fs.existsSync(signsJson)) {
        const json = JSON.parse(fs.readFileSync(signsJson, "utf8"));
        json.pack_id = json.pack_id || folder;
        signpacks.push(json);
      }
    }
  }

  const selectedPack = selectedId && selectedId !== "new"
    ? signpacks.find(p => p.pack_id === selectedId)
    : null;

  // ✅ Check for missing images only if selectedPack exists
  if (selectedPack) {
    const missing = new Set();

    for (const sign of selectedPack.signs || []) {
      const typeFolder = selectedPack.types?.[sign.type] ? sign.type : "";
      const baseFolder = path.join(packsPath, selectedPack.pack_id, typeFolder);

      if (sign.front && !fs.existsSync(path.join(baseFolder, sign.front))) {
        missing.add(sign.front);
      }
      if (sign.back && !fs.existsSync(path.join(baseFolder, sign.back))) {
        missing.add(sign.back);
      }
    }

    // ✅ Final verification — remove false positives
    const stillMissing = [...missing].filter(filename => {
      const sign = selectedPack.signs.find(s => s.front === filename || s.back === filename);
      if (!sign) return true;
      const folder = sign.type || "";
      const filePath = path.join(packsPath, selectedPack.pack_id, folder, filename);
      return !fs.existsSync(filePath);
    });

    // ✅ Save _missing.json and redirect only if actually still missing
    if (stillMissing.length > 0) {
      fs.writeFileSync(
        path.join(packsPath, selectedPack.pack_id, "_missing.json"),
        JSON.stringify(stillMissing, null, 2)
      );
      return res.redirect(`/signpack/repair/${selectedPack.pack_id}`);
    }
  }

  const getAllBackImagesFromSignsJson = (packDir, username, selectedPack) => {
    const signsPath = path.join(packDir, "signs.json");
    if (!fs.existsSync(signsPath)) return [];

    const data = JSON.parse(fs.readFileSync(signsPath, "utf8"));
    if (!Array.isArray(data.signs)) return [];

    const seen = new Set();
    const backFiles = [];

    for (const sign of data.signs) {
      if (sign.back && !seen.has(sign.back)) {
        seen.add(sign.back);

        const folder = sign.type || "";
        const folderPath = folder ? `/${folder}` : "";
        const fullPath = path.join(packDir, folder, sign.back);

        if (fs.existsSync(fullPath)) {
          backFiles.push({
            name: sign.back,
            publicPath: `/users/${username}/packs/${selectedPack.pack_id}${folderPath}/${sign.back}`,
            diskPath: fullPath,
            path: sign.back,
            type: folder
          });
        }
      }
    }

    return backFiles;
  };

  const backImages = selectedPack
    ? getAllBackImagesFromSignsJson(
        path.join(packsPath, selectedPack.pack_id),
        username,
        selectedPack
      )
    : [];

  const selectedSign = selectedPack?.signs?.[selectedSignIndex] || null;

  res.render("signpack/index", {
    user: editorUserView(req.session.user),
    signpacks,
    selectedPack,
    selectedSign,
    backImages,
    ramAiEnabled: !!ramAi.enabled,
    ramAiDebug: !!ramAi.debug,
    ramAiPollMs: Math.min(Math.max(Number(ramAi.statusPollMs) || 5000, 5000), 10000),
  });
});




const AdmZip = require("adm-zip");
const uploadZip = multer({ dest: "uploads/" });

app.post("/signpack/upload", isLoggedIn, uploadZip.single("signpackFile"), async (req, res) => {
  const username = req.session.user.name;
  const file = req.file;

  if (!file || path.extname(file.originalname).toLowerCase() !== ".zip") {
    return res.status(400).send("Only .zip files are supported.");
  }

  try {
    const zip = new AdmZip(file.path);
    const zipEntries = zip.getEntries();

    // Step 1: Find signs.json entry
    const jsonEntry = zipEntries.find(e => e.entryName.endsWith("signs.json"));
    if (!jsonEntry) {
      fs.unlinkSync(file.path);
      return res.status(400).send("signs.json not found in the zip.");
    }

    const parsed = JSON.parse(jsonEntry.getData().toString("utf8"));
    if (!parsed.pack_id) {
      fs.unlinkSync(file.path);
      return res.status(400).send("signs.json is missing pack_id.");
    }

    const packId = parsed.pack_id;
    const userPackPath = path.join(__dirname, "users", username, "packs", packId);

    // Step 2: Extract everything directly into user pack folder
    await mkdirp.mkdirp(userPackPath);
    zip.extractAllTo(userPackPath, true);

    // Step 3: Validate required images exist
    const missing = new Set();
    for (const sign of parsed.signs || []) {
      const typeFolder = parsed.types?.[sign.type] ? sign.type : "";
      const baseFolder = path.join(userPackPath, typeFolder);

      if (sign.front && !fs.existsSync(path.join(baseFolder, sign.front))) {
        missing.add(sign.front);
      }
      if (sign.back && !fs.existsSync(path.join(baseFolder, sign.back))) {
        missing.add(sign.back);
      }
    }

    // Step 4: If missing, save _missing.json and redirect
    if (missing.size > 0) {
      fs.writeFileSync(
        path.join(userPackPath, "_missing.json"),
        JSON.stringify([...missing], null, 2)
      );

      fs.unlinkSync(file.path);
      return res.redirect(`/signpack/repair/${packId}`);
    }

    // Step 5: Cleanup upload zip
    fs.unlinkSync(file.path);
    res.redirect("/signpack?pack=" + packId);
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).send("Failed to process ZIP file.");
  }
});




app.get("/signpack/repair/:packId", isLoggedIn, async (req, res) => {
  const username = req.session.user.name;
  const packId = req.params.packId;
  const userPackPath = path.join(__dirname, "users", username, "packs", packId);
  const missingPath = path.join(userPackPath, "_missing.json");
  const signsPath = path.join(userPackPath, "signs.json");

  if (!fs.existsSync(missingPath)) {
    return res.redirect("/signpack?pack=" + packId); // Nothing to repair
  }

  const missing = JSON.parse(fs.readFileSync(missingPath, "utf8"));
  const signsJson = fs.existsSync(signsPath)
    ? JSON.parse(fs.readFileSync(signsPath, "utf8"))
    : null;

 // Build a map of missing file -> matching sign(s)
const relatedSigns = {};
if (signsJson?.signs?.length) {
  for (const file of missing) {
    relatedSigns[file] = signsJson.signs.find(
      s => s.front === file || s.back === file
    ) || null;
  }
}

console.log("✅ Rendering repair page with selectedPack:", !!signsJson);

res.render("signpack/repair", {
  packId,
  username,
  missing,
  selectedPack: signsJson, // 👈 rename so EJS gets what it expects
  relatedSigns,
  domain,
  signsJson
});

});


const uploadRepair = multer({ dest: "uploads/" });

app.post("/signpack/repair/:packId/upload", isLoggedIn, uploadRepair.single("file"), async (req, res) => {
  const username = req.session.user.name;
  const packId = req.params.packId;
  const filename = req.body.filename;
  const userPackPath = path.join(__dirname, "users", username, "packs", packId);

  if (!filename || !req.file) {
    return res.status(400).send("Missing file or filename");
  }

  const jsonPath = path.join(userPackPath, "signs.json");
  let folder = "";

  if (fs.existsSync(jsonPath)) {
    const signsData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const match = signsData.signs.find(s => s.front === filename || s.back === filename);
    if (match) {
      folder = match.type || "";
    }
  }

  // Fallback to base path if type unknown
  const finalPath = path.join(userPackPath, folder, filename);
  await mkdirp.mkdirp(path.dirname(finalPath));

  console.log("🛠 Repair upload saving to:", finalPath);
  fs.renameSync(req.file.path, finalPath);

  // Clean _missing.json if file is now fixed
  const missingPath = path.join(userPackPath, "_missing.json");
  if (fs.existsSync(missingPath)) {
    const missing = JSON.parse(fs.readFileSync(missingPath, "utf8"));
    const updated = missing.filter(f => f !== filename);
    if (updated.length === 0) {
      fs.unlinkSync(missingPath);
    } else {
      fs.writeFileSync(missingPath, JSON.stringify(updated, null, 2));
    }
  }

  res.redirect(`/signpack/repair/${packId}`);
});






app.post("/signpack/reorder/:packId",  async (req, res) => {
  const username = req.session.user.name;
  const packId = req.params?.packId;
  const newOrder = req.body?.order;

  console.log(username)
  console.log(packId)
  console.log(newOrder)

  // Validate inputs
  if (!username || !packId || !Array.isArray(newOrder)) {
    console.error("Missing username, packId, or order array");
    return res.status(400).json({ success: false, error: "Invalid input" });
  }

  const packPath = path.join(__dirname, "users", username, "packs", packId, "signs.json");

  if (!fs.existsSync(packPath)) {
    return res.status(404).json({ success: false, error: "Signpack not found" });
  }

  try {
    const packData = JSON.parse(fs.readFileSync(packPath));
    const originalSigns = packData.signs || [];

    // Reorder signs based on the provided ID order
    const reordered = newOrder.map(id => originalSigns.find(s => s.id === id)).filter(Boolean);
    packData.signs = reordered;

    fs.writeFileSync(packPath, JSON.stringify(packData, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to reorder signs:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});


app.post("/signpack/add-to-pack/:id", isLoggedIn, upload.fields([
  { name: "signs", maxCount: 1 },
  { name: "back", maxCount: 1 }
]), async (req, res) => {
  console.log(req.body)
  const username = req.session.user.name;
  const userPath = path.join(__dirname, "users");
  const packId = req.params.id === "new" ? uuidv4() : req.params.id;
  const basePath = path.join(userPath, username, "packs", packId);
  const { signId, signstext, packName, signtype_folder, signtype_label, existingBack, signstool } = req.body;
  const folder = signtype_folder.trim().toLowerCase();
const displayName = signtype_label?.trim();
  const typeFolder = path.join(basePath, folder);

  await mkdirp.mkdirp(typeFolder);

  const safeName = signstext.trim().replace(/\s+/g, "_");
  const frontFilename = `${safeName}_front.png`.toLowerCase();
  const backFilename = `${safeName}_back.png`.toLowerCase();

  const frontFile = req.files?.signs?.[0] || null;
  const backFile = req.files?.back?.[0] || null;

  const frontPath = path.join(typeFolder, frontFilename);
  const backPath = path.join(typeFolder, backFilename);

  const jsonPath = path.join(basePath, "signs.json");
  let signsData = {
    name: packName,
    pack_id: packId,
    note: "Made or edited with TC Signpack Maker by Gamearoo — https://signs.gamearoo.dev",
    signs: [],
    author: username,
    types: {}
  };

  if (fs.existsSync(jsonPath)) {
    signsData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  }

  signsData.types = signsData.types || {};
  if (folder && displayName && !signsData.types[folder]) {
    signsData.types[folder] = displayName;
  }

  signsData.name = packName || signsData.name;

  let existingIndex = -1;
  if (signId) {
    existingIndex = signsData.signs.findIndex(s => s.id === signId);
  }
  const existing = existingIndex !== -1 ? signsData.signs[existingIndex] : null;

  if (frontFile) {
    if (fs.existsSync(frontPath)) fs.unlinkSync(frontPath);
    fs.renameSync(frontFile.path, frontPath);
  } else if (existing && existing.type !== folder && existing.front) {
    const oldFront = path.join(basePath, existing.type, existing.front);
    if (fs.existsSync(oldFront)) fs.copyFileSync(oldFront, frontPath);
  }

  let finalBack = existing?.back || null;

  if (backFile) {
    if (fs.existsSync(backPath)) fs.unlinkSync(backPath);
    fs.renameSync(backFile.path, backPath);
    finalBack = backFilename;
  
  } else if (existingBack) {
    const backBase = path.basename(existingBack); // e.g. default_square_back.png
    const existingBackRel = existingBack.startsWith("/") ? existingBack.slice(1) : existingBack; // remove leading slash
    const existingBackAbs = path.join(__dirname, existingBackRel); // full path to source image
    const targetBackPath = path.join(typeFolder, backBase); // full path to target in new type folder
  
    try {
      if (!fs.existsSync(targetBackPath) && fs.existsSync(existingBackAbs)) {
        await fs.promises.copyFile(existingBackAbs, targetBackPath);
        console.log(`Copied from ${existingBackAbs} to ${targetBackPath}`);
      }
  
      if (fs.existsSync(targetBackPath)) {
        finalBack = backBase;
      } else {
        console.warn(`Back image still missing after copy: ${targetBackPath}`);
      }
    } catch (err) {
      console.error("Failed to copy existingBack image:", err);
    }
  }



  

  const halignMap = { "0": "left", "1": "center", "2": "right" };
  const valignMap = { "0": "top", "1": "center", "2": "bottom" };

  let textlines = [];
  if (req.body.textlines) {
    const raw = req.body.textlines;
    textlines = Object.values(raw).map(entry => {
      let colorInt = 0;
    if (entry.color?.startsWith("#")) {
      try { colorInt = parseInt(entry.color.slice(1), 16); } catch {}
    }

      return {
        label: entry.label.toLowerCase() || "",
        x: parseFloat(entry.x) || 0,
        y: parseFloat(entry.y) || 0,
        width: parseFloat(entry.width) || 0,
        maxlength: parseInt(entry.maxlength) || 0,
        xscale: parseFloat(entry.xscale) || 1,
        yscale: parseFloat(entry.yscale) || 1,
        halign: halignMap[entry.halign] || entry.halign || "center",
        valign: valignMap[entry.valign] || entry.valign || "center",
         color: colorInt || 0
      };
    });
  }

  let halfheight = req.body.halfheight === "on";

  const updatedSign = {
    id: existing?.id || uuidv4(),
    name: signstext,
    type: folder,
    front: frontFile ? frontFilename : existing?.front || null,
    back: finalBack,
    halfheight,
    tooltip: signstool,
    textlines
  };

  if (existingIndex !== -1) {
    signsData.signs[existingIndex] = updatedSign;
  } else {
    signsData.signs.push(updatedSign);
  }

  console.log(existingIndex !== -1 ? "📝 Updated sign:" : "➕ New sign:", updatedSign);
  fs.writeFileSync(jsonPath, JSON.stringify(signsData, null, 2));
  res.redirect("/signpack?pack=" + packId);
});

app.get("/auth/discord/link", isLoggedIn, passport.authenticate("discord", {
  callbackURL: `${domain}/auth/discord/link/callback`,
  scope: ["identify", "email"]
}));

app.get("/auth/discord/link/callback", isLoggedIn, passport.authenticate("discord", {
  failureRedirect: "/signpack?error=yes",
  callbackURL: `${domain}/auth/discord/link/callback`
}), async (req, res) => {
  try {
    console.log(req.user)
    const { discordId, discordTag, _id } = req.user;
    const loggedInEmail = req.session.user._id;

    const user = await usersDB.findOne({ _id: loggedInEmail });
    if (!user) return res.redirect("/login");

    console.log("🔗 Linking Discord...");
    console.log("Before:", user.discordId, user.discordTag);

    user.discordId = discordId;
    user.discordTag = discordTag;

    await user.save();

    const confirm = await usersDB.findOne({ _id: loggedInEmail });
    console.log("After:", confirm.discordId, confirm.discordTag);

    req.session.user.discord = discordId;

    res.redirect("/signpack");
  } catch (err) {
    console.error("Error linking Discord account:", err);
    res.redirect("/signpack?error=link_failed");
  }
});




app.post("/signpack/edit/:packId/:signId",isLoggedIn, upload.fields([
  { name: "signs", maxCount: 1 },
  { name: "back", maxCount: 1 }
]), async (req, res) => {
  console.log(req.body)
  const { packId, signId } = req.params;
  const username = req.session.user.name;
  const basePath = path.join(__dirname, "users", username, "packs", packId);
  const jsonPath = path.join(basePath, "signs.json");

  if (!fs.existsSync(jsonPath)) return res.status(404).send("Pack not found");

  let {existingBack} = req.body;

  const signsData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  if (!signsData.note || !signsData.note.includes("TC Signpack Maker")) {
    signsData.note = "note: Made or edited with TC Signpack Maker by Gamearoo — https://signs.gamearoo.dev";
  }
  
  const signIndex = signsData.signs.findIndex(s => s.id === signId);
  if (signIndex === -1) return res.status(404).send("Sign not found");

  const existing = signsData.signs[signIndex];
  const signtype = req.body.signtype_folder?.trim().toLowerCase() || existing.type;
  const signtypename = req.body.signtype_label?.trim();
  const typeFolder = path.join(basePath, signtype);
  await mkdirp.mkdirp(typeFolder);

  const safeName = req.body.signstext.trim().replace(/\s+/g, "_");
  const frontFilename = `${safeName}_front.png`.toLowerCase();
  const backFilename = `${safeName}_back.png`.toLowerCase();

  const frontFile = req.files?.signs?.[0] || null;
  const backFile = req.files?.back?.[0] || null;

  let finalBack = existing?.back || null;

  if (backFile) {
    if (fs.existsSync(backPath)) fs.unlinkSync(backPath);
    fs.renameSync(backFile.path, backPath);
    finalBack = backFilename;
  
  } else if (existingBack) {
    const backBase = path.basename(existingBack); // e.g. default_square_back.png
    const existingBackRel = existingBack.startsWith("/") ? existingBack.slice(1) : existingBack; // remove leading slash
    const existingBackAbs = path.join(__dirname, existingBackRel); // full path to source image
    const targetBackPath = path.join(typeFolder, backBase); // full path to target in new type folder
  
    try {
      if (!fs.existsSync(targetBackPath) && fs.existsSync(existingBackAbs)) {
        await fs.promises.copyFile(existingBackAbs, targetBackPath);
        console.log(`Copied from ${existingBackAbs} to ${targetBackPath}`);
      }
  
      if (fs.existsSync(targetBackPath)) {
        finalBack = backBase;
      } else {
        console.warn(`Back image still missing after copy: ${targetBackPath}`);
      }
    } catch (err) {
      console.error("Failed to copy existingBack image:", err);
    }
  }
  


  let finalFront = existing.front;
  if (frontFile) {
    const frontPath = path.join(typeFolder, frontFilename);
    if (fs.existsSync(frontPath)) fs.unlinkSync(frontPath);
    fs.renameSync(frontFile.path, frontPath);
    finalFront = frontFilename;
  }

  

  const halignMap = { "0": "left", "1": "center", "2": "right" };
  const valignMap = { "0": "top", "1": "center", "2": "bottom" };
  const raw = req.body.textlines || {};
  const textlines = Object.values(raw).map(entry => {
    let colorInt = 0;
    if (entry.color?.startsWith("#")) {
      try { colorInt = parseInt(entry.color.slice(1), 16); } catch {}
    }

    return {
      label: entry.label.toLowerCase() || "",
      x: parseFloat(entry.x) || 0,
      y: parseFloat(entry.y) || 0,
      width: parseFloat(entry.width) || 0,
      maxlength: parseInt(entry.maxlength) || 0,
      xscale: parseFloat(entry.xscale) || 1,
      yscale: parseFloat(entry.yscale) || 1,
      halign: halignMap[entry.halign] || entry.halign || "center",
      valign: valignMap[entry.valign] || entry.valign || "center",
      color: colorInt || 0
    };
  });

  let halfheight = req.body.halfheight === "on";

  signsData.types = signsData.types || {};
  if (signtype && signtypename) {
    signsData.types[signtype] = signtypename;
    
  }

  signsData.signs[signIndex] = {
    ...existing,
    name: req.body.signstext,
    type: signtype,
    front: finalFront,
    back: finalBack,
    halfheight,
    tooltip: req.body.signstool,
    textlines
  };

  fs.writeFileSync(jsonPath, JSON.stringify(signsData, null, 2));
  res.redirect("/signpack?pack=" + packId + "&signIndex=" + (signIndex + 1));
});


app.get("/signpack/multiblock/:packId", isLoggedIn, async (req, res) => {
  const username = req.session.user.name;
  const packId = req.params.packId;
  const basePath = path.join(__dirname, "users", username, "packs", packId);
  const jsonPath = path.join(basePath, "signs.json");

  if (!fs.existsSync(jsonPath)) return res.status(404).send("Signpack not found.");

  const signsData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  await refreshSessionUser(req, usersDB);
  res.render("signpack/multiblock", {
    user: editorUserView(req.session.user),
    selectedPack: signsData,
    packId,
    domain
  });
});

const Jimp = require("jimp");

const uploadFragment = multer({ dest: "uploads/" });



const uploadFragmentTiles = multer({ storage: multer.memoryStorage() });

app.post("/signpack/fragment-upload/:packId", isLoggedIn, uploadFragmentTiles.fields([
  { name: "frontTiles" },
  { name: "backTiles" }
]), async (req, res) => {
  try {
    const username = req.session.user.name;
    const packId = req.params.packId;
    const { baseName, signtype_folder, signtype_label, rows, cols } = req.body;
    let generatedNames = [];
    try {
      const parsedNames = JSON.parse(req.body.generatedNames || "[]");
      if (Array.isArray(parsedNames)) {
        generatedNames = parsedNames
          .map((n) => String(n || "").trim())
          .filter(Boolean);
      }
    } catch (_err) {}
    const textlineTemplate = String(req.body.textlineTemplate || "").trim();
    const exportOpts = parseExportOptions(req.body);

    const basePath = path.join(__dirname, "users", username, "packs", packId);
    const type = signtype_folder.trim().toLowerCase();
    const label = signtype_label.trim();
    const typePath = path.join(basePath, type);
    const jsonPath = path.join(basePath, "signs.json");

    await mkdirp.mkdirp(typePath);

    let signsData = fs.existsSync(jsonPath)
      ? JSON.parse(fs.readFileSync(jsonPath, "utf8"))
      : {
          name: packId,
          pack_id: packId,
          note: "Made or edited with TC Signpack Maker by Gamearoo — https://signs.gamearoo.dev",
          signs: [],
          author: username,
          types: {}
        };

    signsData.types[type] = label;

    const fronts = req.files?.frontTiles || [];
    const backs = req.files?.backTiles || [];
    const newSigns = [];

    let index = 0;
    for (let row = 0; row < parseInt(rows); row++) {
      for (let col = 0; col < parseInt(cols); col++) {
        const id = uuidv4();
        const fname = `${baseName}_${row + 1}_${col + 1}`.toLowerCase().replace(/\s+/g, "_");
        const frontName = `${fname}_front.png`;
        const backName = `${fname}_back.png`;

        const frontPath = path.join(typePath, frontName);
        const backPath = path.join(typePath, backName);

        if (fronts[index]) {
          const frontPng = await renderTilePng(fronts[index].buffer, exportOpts);
          fs.writeFileSync(frontPath, frontPng);
        }

        if (backs[index]) {
          const backPng = await renderTilePng(backs[index].buffer, exportOpts);
          fs.writeFileSync(backPath, backPng);
        }

        const generatedIndex = row * parseInt(cols) + col;
        const signName =
          generatedNames[generatedIndex] || `${baseName} ${row + 1},${col + 1}`;
        const textlineTemplateEntry = textlineTemplate
          ? [
              {
                label: textlineTemplate,
                x: 8,
                y: 8,
                width: 8,
                color: 16777215,
              },
            ]
          : [];

        newSigns.push({
          id,
          name: signName,
          type,
          front: frontName,
          back: backs[index] ? backName : null,
          halfheight: false,
          textlines: textlineTemplateEntry
        });

        index++;
      }
    }

    signsData.signs.push(...newSigns);
    fs.writeFileSync(jsonPath, JSON.stringify(signsData, null, 2));

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ Fragment upload error:", err);
    res.status(500).send("Failed to process tiles.");
  }
});

app.use('/js', express.static(path.join(__dirname, 'public/js')));

app.use("/api/ram-ai", createRamAiRouter({ ramAi }));

app.listen(PORT, () => {
  console.log(`Signpack Maker running at http://localhost:${PORT}`);
});

