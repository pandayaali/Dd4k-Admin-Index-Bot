(async () => {

require('events').EventEmitter.defaultMaxListeners = 20;

const { Telegraf } = require("telegraf");
const express = require("express");
const app = express();
const axios = require("axios");

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const JSONBIN_KEY = process.env.JSONBIN_KEY;

const ATTACH_BIN = process.env.ATTACH_BIN;
const IMAGE_BIN = process.env.IMAGE_BIN;
const CHANNEL_BIN = process.env.CHANNEL_BIN;

async function loadJson(binId) {
  const res = await axios.get(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
    headers: { "X-Access-Key": JSONBIN_KEY }
  });
  return res.data.record;
}

async function saveJson(binId, data) {
  await axios.put(`https://api.jsonbin.io/v3/b/${binId}`, data, {
    headers: {
      "Content-Type": "application/json",
      "X-Access-Key": JSONBIN_KEY
    }
  });
}

app.get("/", (req, res) => res.send("Attach Bot is Live!"));
app.listen(3000);

// 🟢 BOT SET
const bot = new Telegraf(process.env.BOT_TOKEN_ATTACH);
const botUsername = process.env.BOT_USERNAME_ATTACH;
const admins = [1081656301, 1361262107]; // 🔐 Add admin IDs here

let waitingForMessage = {};
let imageData = await loadJson(IMAGE_BIN);

let channelData = {};
try {
  channelData = await loadJson(CHANNEL_BIN);
} catch {
  channelData = { channel_id: null };
}

// ✅ /start with payload
bot.start(async (ctx) => {
  const payload = ctx.startPayload;

  if (payload && payload.startsWith("msg_")) {
    let attachData = await loadJson(ATTACH_BIN);

    const entry = attachData[payload];
    if (entry) {
      if (imageData && imageData.file_id) {
        const sent = await ctx.telegram.sendPhoto(ctx.chat.id, imageData.file_id, {
          caption: entry.text,
          caption_entities: entry.entities,
        });

        // 🔥 Auto delete after 30 min
        setTimeout(() => {
          ctx.telegram.deleteMessage(ctx.chat.id, sent.message_id).catch(() => {});
        }, 30 * 60 * 1000);
      } else {
        const sent = await ctx.telegram.sendMessage(ctx.chat.id, entry.text, {
          entities: entry.entities
        });
        setTimeout(() => {
          ctx.telegram.deleteMessage(ctx.chat.id, sent.message_id).catch(() => {});
        }, 30 * 60 * 1000);
      }
    } else {
      ctx.reply("❌ Message not found or expired.");
    }
    return;
  }

  ctx.reply(`👋 *Hi* *${ctx.from.first_name}*!\n\n*I'm DD4K's Twins Attach Message Bot* 🤖\n\n*Use /attach to create special link.*\n*Use /uploadimage to set permanent image.* \n\n*But not for YOU 🤣*`, {
    parse_mode: "Markdown"
  });
});

// ✅ /attach
bot.command("attach", (ctx) => {
  if (!admins.includes(ctx.from.id)) {
    return ctx.reply("🛑 Who the hell invited you here? This bot is *NOT* your playground, loser.", { parse_mode: "Markdown" });
  }

  waitingForMessage[ctx.from.id] = true;
  ctx.reply("📝 Send the message to attach (with formatting).");
});

// ✅ /uploadimage → set image to private channel
bot.command("uploadimage", (ctx) => {
  if (!admins.includes(ctx.from.id)) {
    return ctx.reply("🚫 Sorry, only *admins* can upload images here. Go cry to your mom.", { parse_mode: "Markdown" });
  }
  ctx.reply("📸 Now send the image you want to use as *permanent banner*.");
  waitingForMessage[ctx.from.id] = "uploading_image";
});

// ✅ /privatechannel → forward message from private channel
bot.command("privatechannel", (ctx) => {
  if (!admins.includes(ctx.from.id)) return;
  ctx.reply("📨 Please forward *any message* from your private channel now.");
  waitingForMessage[ctx.from.id] = "set_private_channel";
});

// ✅ Handle ALL messages
bot.on("message", async (ctx) => {
  const uid = ctx.from.id;

  // 🛡 If trying to use without access
  if (!admins.includes(uid) && ((ctx.message.text && ctx.message.text.startsWith("/")) || waitingForMessage[uid])) {
    return ctx.reply("😤 You're not allowed here. Even your brain isn't allowed in public.");
  }

  const waitType = waitingForMessage[uid];

  // 🎯 Save private channel ID
  if (waitType === "set_private_channel" && ctx.message.forward_from_chat) {
    const channelId = ctx.message.forward_from_chat.id;
    channelData.channel_id = channelId;
    await saveJson(CHANNEL_BIN, channelData);
    delete waitingForMessage[uid];
    return ctx.reply(`✅ Private Channel ID saved: \`${channelId}\``, { parse_mode: "Markdown" });
  }

  // 📥 Uploading image
  if (waitType === "uploading_image" && ctx.message.photo && channelData.channel_id) {
    const photo = ctx.message.photo.pop();
    const fileId = photo.file_id;

    const fwd = await ctx.telegram.sendPhoto(channelData.channel_id, fileId, { caption: "DD4K Permanent Image" });

    imageData = { file_id: fwd.photo[fwd.photo.length - 1].file_id };
    await saveJson(IMAGE_BIN, imageData);

    delete waitingForMessage[uid];
    return ctx.reply("✅ Image saved permanently in private channel!");
  }

  // 📎 Attach message
  if (waitType === true && ctx.message.text) {
    const msgId = `msg_${Date.now()}`;
    let attachData = {};
    try {
      attachData = await loadJson(ATTACH_BIN);
    } catch (e) {}

    attachData[msgId] = {
      text: ctx.message.text,
      entities: ctx.message.entities || []
    };

    await saveJson(ATTACH_BIN, attachData);
    const link = `https://t.me/${botUsername}?start=${msgId}`;
    await ctx.reply(`✅ Message saved!\n\n🔗 Link: ${link}`);
    delete waitingForMessage[uid];
  }
});

// ✅ Set Commands Menu
bot.telegram.setMyCommands([
  { command: "attach", description: "📎 [Attach Message]" },
  { command: "uploadimage", description: "🖼 [Set Permanent Image]" },
  { command: "privatechannel", description: "🔒 [Set Private Channel]" },
  { command: "start", description: "🚀 [Start / View Attached Message]" }
]);

// ✅ Launch
bot.launch();
console.log("🤖 Attach Bot is running with Private Channel Image & Auto Delete!");

})();
