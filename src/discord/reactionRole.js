// ============================================================
//  reactionRole.js — Reaction Role System
// ============================================================
const { EmbedBuilder } = require('discord.js');
const { CONFIG } = require('./config');
const { logEvent } = require('./logger');

async function createReactionRoleMessage(channel) {
  const embed = new EmbedBuilder()
    .setTitle('🎭 เลือก Role ของคุณ')
    .setDescription(
      Object.entries(CONFIG.REACTION_ROLES)
        .map(([emoji, roleId]) => `${emoji} — <@&${roleId}>`)
        .join('\n')
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'React เพื่อรับ/ถอด role' });

  const msg = await channel.send({ embeds: [embed] });
  for (const emoji of Object.keys(CONFIG.REACTION_ROLES)) await msg.react(emoji);
  return msg;
}

function registerReactionRoleEvents(client) {
  client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.message.partial) await reaction.message.fetch();
    if (reaction.message.id !== CONFIG.REACTION_ROLE_MESSAGE_ID) return;

    const roleId = CONFIG.REACTION_ROLES[reaction.emoji.name];
    if (!roleId) return;

    const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    const role = reaction.message.guild.roles.cache.get(roleId);
    if (!role) return;

    await member.roles.add(role).catch(console.error);
    logEvent(reaction.message.guild, {
      type: 'ROLE_ADD', color: 0x57f287, title: '✅ เพิ่ม Role',
      fields: [
        { name: 'สมาชิก', value: `${user} (${user.id})`, inline: true },
        { name: 'Role',   value: `${role}`,               inline: true },
        { name: 'วิธี',   value: 'Reaction Role',         inline: true },
      ],
    });
  });

  client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.message.partial) await reaction.message.fetch();
    if (reaction.message.id !== CONFIG.REACTION_ROLE_MESSAGE_ID) return;

    const roleId = CONFIG.REACTION_ROLES[reaction.emoji.name];
    if (!roleId) return;

    const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    const role = reaction.message.guild.roles.cache.get(roleId);
    if (!role) return;

    await member.roles.remove(role).catch(console.error);
    logEvent(reaction.message.guild, {
      type: 'ROLE_REMOVE', color: 0xed4245, title: '❌ ลบ Role',
      fields: [
        { name: 'สมาชิก', value: `${user} (${user.id})`, inline: true },
        { name: 'Role',   value: `${role}`,               inline: true },
      ],
    });
  });
}

module.exports = { createReactionRoleMessage, registerReactionRoleEvents };
