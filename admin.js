const { Telegraf } = require("telegraf");
const fs = require("fs");
const schedule = require("node-schedule");

const bot = new Telegraf("7762779405:AAFCaqTA1ofXquZEHcR1sQJtYHzKi618ksg");

// ✅ Admins
const ADMINS = [1081656301, 1361262107, 6335193759];

// 📁 File paths
const storagePath = "storage.json";
const configPath = "config.json";

// ✅ Utilities
function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}
function isAdmin(ctx) {
  return ADMINS.includes(ctx.from.id);
}
function saveStorage() {
  fs.writeFileSync(storagePath, JSON.stringify(storage, null, 2));
}
function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}
function loadConfig() {
  if (!fs.existsSync(configPath)) return {
    last_run: null, main_channel_range: {}, backup_channel_range: {}, deleted_main_range: {}
  };
  return JSON.parse(fs.readFileSync(configPath));
}

let storage = fs.existsSync(storagePath) ? JSON.parse(fs.readFileSync(storagePath)) : {};

// 🔒 Set static message
bot.command("setstaticmessage", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const reply = ctx.message.reply_to_message;
  if (reply) {
    storage.static_channel = ctx.chat.id;
    storage.static_message_id = reply.message_id;
    saveStorage();
    return ctx.reply("✅ Static message set from reply");
  }
  const parts = ctx.message.text.split(" ");
  if (parts.length < 2) return ctx.reply("⚠️ Send: /setstaticmessage <link>");

  const link = parts[1];
  const match = link.match(/https:\/\/t\.me\/([\w_]+)\/(\d+)/);
  if (!match) return ctx.reply("❌ Invalid link format");
  storage.static_channel = "@" + match[1];
  storage.static_message_id = parseInt(match[2]);
  saveStorage();
  ctx.reply("✅ Static message set from link");
});

// 🔁 Set forward channel
let waitingFor = { forward: null };
bot.command("setforwardchannel", (ctx) => {
  if (!isAdmin(ctx)) return;
  waitingFor.forward = ctx.from.id;
  ctx.reply("📥 Now forward a message from your private channel");
  setTimeout(() => waitingFor.forward = null, 2 * 60 * 1000);
});

bot.on("message", async (ctx) => {
  if (waitingFor.forward !== ctx.from.id) return;
  const chatId = ctx.message.forward_from_chat?.id || ctx.message.sender_chat?.id;
  if (!chatId) return ctx.reply("❌ Invalid forward");
  storage.forward_channel_id = chatId;
  saveStorage();
  waitingFor.forward = null;
  ctx.reply("✅ Forward channel saved");
});

// 🧪 Test Copy
bot.command("testcopy", async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    await bot.telegram.copyMessage(ctx.chat.id, storage.static_channel, storage.static_message_id);
    ctx.reply("✅ Copy test success.");
  } catch (e) {
    ctx.reply("❌ Copy failed: " + (e.description || e.message));
  }
});

// ⏱️ Schedule pre-check 5 minutes before backup
schedule.scheduleJob({ hour: 18, minute: 47, tz: "Asia/Kolkata" }, preBackupCheck);

// 📦 Backup Job
schedule.scheduleJob({ hour: 18, minute: 51, tz: "Asia/Kolkata" }, async () => {
  console.log("[1] 📦 Backup started...");
  const forward = storage.forward_channel_id;
  const main = storage.static_channel;
  const staticId = storage.static_message_id;
  const config = loadConfig();

  // 🧹 Clean private backup channel
  for (let i = 1; i <= 200; i++) {
    try { await bot.telegram.deleteMessage(forward, i); } catch {}
  }

  let mainIDs = [], backupIDs = [];

  const configs = loadConfig();
let i = Math.max(staticId + 1, (config.deleted_main_range?.end_id || 0) + 1);
let skippedCount = 0;
while (skippedCount < 20) {
  let retries = 0;
  while (retries < 5) {
    try {
      const msg = await bot.telegram.copyMessage(forward, main, i);
      console.log(`[1] ✅ Copied ${i} → ${msg.message_id}`);
      mainIDs.push(i);
      backupIDs.push(msg.message_id);
      skippedCount = 0; // Reset on success
      await sleep(1000);
      break;
    } catch (e) {
      const desc = e.description || "";
      if (desc.includes("retry after")) {
        const wait = parseInt(desc.match(/\d+/)?.[0]) || 3;
        console.log(`⏳ Retry after ${wait}s for ${i}`);
        await sleep((wait + 1) * 1000);
      } else if (desc.includes("not found")) {
        console.log(`[1] ⚠️ Skipped ${i} - Not Found`);
        skippedCount++;
        break;
      } else {
        retries++;
        console.log(`[1] ❌ Copy error at ${i} retry ${retries}: ${desc}`);
        await sleep(3000);
      }
    }
  }
  i++;
}

  config.last_run = new Date().toISOString().split("T")[0];
  config.main_channel_range = { start_id: mainIDs[0] || 0, end_id: mainIDs.at(-1) || 0 };
  config.backup_channel_range = { start_id: backupIDs[0] || 0, end_id: backupIDs.at(-1) || 0 };
  saveConfig(config);

  console.log("[1] ✅ Backup complete.");
});

// 🔁 Repost Job
schedule.scheduleJob({ hour: 18, minute: 54, tz: "Asia/Kolkata" }, async () => {
  console.log("[1] 🔁 Repost started...");
  const config = loadConfig();
  const main = storage.static_channel;

  // 🗑 Delete existing reposts
  for (let i = config.main_channel_range.start_id; i <= config.main_channel_range.end_id; i++) {
    try { await bot.telegram.deleteMessage(main, i); } catch {}
  }

  config.deleted_main_range = {
    start_id: config.main_channel_range.start_id,
    end_id: config.main_channel_range.end_id
  };
  saveConfig(config);

  // ♻ Repost all from private
  for (let i = config.backup_channel_range.start_id; i <= config.backup_channel_range.end_id; i++) {
    let retries = 0;
    while (retries < 5) {
      try {
        await bot.telegram.copyMessage(main, storage.forward_channel_id, i);
        console.log(`[1] 🔁 Reposted ${i}`);
        await sleep(1000);
        break;
      } catch (e) {
        const desc = e.description || "";
        if (desc.includes("retry after")) {
          const wait = parseInt(desc.match(/\d+/)?.[0]) || 3;
          console.log(`⏳ Retry after ${wait}s at repost ${i}`);
          await sleep((wait + 1) * 1000);
        } else {
          retries++;
          console.log(`[1] ❌ Repost error at ${i} retry ${retries}: ${desc}`);
          await sleep(3000);
        }
      }
    }
  }

  console.log("[1] ✅ Repost complete.");
  
  // 🧹 Final wipe of backup channel after repost
console.log("🧹 Final wipe of backup channel after repost...");
const configes = loadConfig();
const from = Math.max((configes.backup_channel_range.start_id || 2) - 1, 1);
const to = configes.backup_channel_range.end_id || from + 200;

for (let i = from; i <= to; i++) {
  try {
    await bot.telegram.deleteMessage(storage.forward_channel_id, i);
  } catch (e) {
    if (e.description?.includes("message to delete not found")) break;
  }
}
console.log(`✅ Backup channel cleaned from ID ${from} to ${to}`);
});

// 🔍 Pre-check before backup (5 min early)
async function preBackupCheck() {
  const staticId = storage.static_message_id;
  const forward = storage.forward_channel_id;
  const main = String(storage.static_channel);

  console.log("🔍 Checking next message ID before backup...");

  let nextId = staticId + 1;
  let found = false;

  while (!found && nextId < staticId + 999999) {
    try {
      await bot.telegram.getChat(forward); // ensure it's valid
      await bot.telegram.forwardMessage(forward, main, nextId);
      found = true;
      console.log(`✅ Found next message at ID: ${nextId}`);

      const config = loadConfig();
      config.deleted_main_range = { start_id: staticId, end_id: nextId - 1 };
      saveConfig(config);
    } catch (e) {
      const desc = e.description || "";
      if (desc.includes("not found") || desc.includes("message to copy not found")) {
        nextId++;
      } else if (desc.includes("retry after")) {
        const wait = parseInt(desc.match(/\d+/)?.[0]) || 3;
        console.log(`⏳ Rate limited, wait ${wait}s...`);
        await sleep((wait + 1) * 1000);
      } else {
        console.log(`❌ Error while checking ${nextId}: ${desc}`);
        break;
      }
    }
  }

  if (!found) {
    console.log("⚠️ No next message found after static. Using staticId + 1");
  }
}

// 🟢 /start
bot.start((ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.reply("👋 DD4K Admin Bot\n\n/setstaticmessage\n/setforwardchannel\n/testcopy");
});

// 📋 /menu
bot.command("menu", (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.reply("📋 Admin Menu", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Set Static Message", callback_data: "set_static" }],
        [{ text: "Set Forward Channel", callback_data: "set_forward" }]
      ]
    }
  });
});

console.log("🤖 Admin bot running...");
bot.launch();
