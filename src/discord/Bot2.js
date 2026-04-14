require('dotenv').config({ override: true });

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { registerCommands }           = require('./commands');
const { registerLogEvents }          = require('./logger');
const { registerReactionRoleEvents } = require('./reactionRole');
const { registerInteractions }       = require('./interactions');

const TOKEN = process.env.DISCORD_TOKEN2;
if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN2 ไม่ได้ตั้งค่าใน .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

registerLogEvents(client);
registerReactionRoleEvents(client);
registerInteractions(client);

client.once('clientReady', async () => {
  console.log(`✅ [Management Bot] พร้อมใช้งาน: ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} server(s)`);
  client.user.setActivity('จัดการ Server | /help', { type: 3 });
  await registerCommands();
});

client.login(TOKEN);
