// ============================================================
//  interactions.js — Slash Command + Button interaction handler
// ============================================================
const { EmbedBuilder } = require('discord.js');
const { isAdmin, isStaff } = require('./config');
const { logEvent } = require('./logger');
const { createTicketPanel, handleTicketOpen, handleTicketClose, handleTicketClaim } = require('./ticket');
const { createReactionRoleMessage } = require('./reactionRole');

function registerInteractions(client) {
  client.on('interactionCreate', async (interaction) => {

    // ── Buttons ────────────────────────────────────────────
    if (interaction.isButton()) {
      switch (interaction.customId) {
        case 'ticket_open':        return handleTicketOpen(interaction, false);
        case 'ticket_open_urgent': return handleTicketOpen(interaction, true);
        case 'ticket_close':       return handleTicketClose(interaction);
        case 'ticket_claim':       return handleTicketClaim(interaction);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName, member, guild } = interaction;

    // ── Guard: Admin หรือ Staff เท่านั้น ─────────────────
    if (!isStaff(member)) {
      return interaction.reply({ content: '❌ ไม่มีสิทธิ์ใช้คำสั่งนี้', flags: 64 });
    }

    // ── /ticket ──────────────────────────────────────────
    if (commandName === 'ticket') {
      await createTicketPanel(interaction.channel);
      return interaction.reply({ content: '✅ สร้างแผงคำร้องเรียบร้อย!', flags: 64 });
    }

    // ── /reactionrole ────────────────────────────────────
    if (commandName === 'reactionrole') {
      await interaction.deferReply({ flags: 64 });
      const msg = await createReactionRoleMessage(interaction.channel);
      return interaction.editReply({
        content:
          `✅ สร้าง Reaction Role แล้ว!\nMessage ID: \`${msg.id}\`\n` +
          `👉 ใส่ใน \`.env\` → \`REACTION_ROLE_MESSAGE_ID\` แล้ว restart Bot`,
      });
    }

    // ── /kick ────────────────────────────────────────────
    if (commandName === 'kick') {
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') || 'ไม่ระบุเหตุผล';
      if (!target?.kickable)
        return interaction.reply({ content: '❌ ไม่สามารถ Kick สมาชิกนี้ได้', flags: 64 });
      await target.kick(reason);
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('👢 Kick สมาชิก')
            .addFields(
              { name: 'สมาชิก', value: target.user.tag, inline: true },
              { name: 'เหตุผล', value: reason,          inline: true }
            )
            .setColor(0xfee75c)
            .setTimestamp(),
        ],
      });
    }

    // ── /ban ─────────────────────────────────────────────
    if (commandName === 'ban') {
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') || 'ไม่ระบุเหตุผล';
      if (!target?.bannable)
        return interaction.reply({ content: '❌ ไม่สามารถ Ban สมาชิกนี้ได้', flags: 64 });
      await target.ban({ reason });
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔨 Ban สมาชิก')
            .addFields(
              { name: 'สมาชิก', value: target.user.tag, inline: true },
              { name: 'เหตุผล', value: reason,          inline: true }
            )
            .setColor(0xed4245)
            .setTimestamp(),
        ],
      });
    }

    // ── /unban ───────────────────────────────────────────
    if (commandName === 'unban') {
      const userId = interaction.options.getString('userid');
      await guild.members.unban(userId).catch(() => null);
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ ปลดแบน')
            .setDescription(`ปลดแบน \`${userId}\` แล้ว`)
            .setColor(0x57f287)
            .setTimestamp(),
        ],
      });
    }

    // ── /clear ───────────────────────────────────────────
    if (commandName === 'clear') {
      if (!isAdmin(member)) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('❌ ไม่มีสิทธิ์')
              .setDescription('คำสั่ง `/clear` ใช้ได้เฉพาะ **Administrator** หรือ **Admin Role** เท่านั้น')
              .setColor(0xed4245),
          ],
          flags: 64,
        });
      }

      const amount     = interaction.options.getInteger('amount');
      const targetUser = interaction.options.getUser('user');
      await interaction.deferReply({ flags: 64 });

      let messages = await interaction.channel.messages.fetch({ limit: 100 });
      if (targetUser) messages = messages.filter((m) => m.author.id === targetUser.id);

      const toDelete = [...messages.values()].slice(0, amount);
      const recent   = toDelete.filter((m) => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
      const old      = toDelete.filter((m) => Date.now() - m.createdTimestamp >= 14 * 24 * 60 * 60 * 1000);

      let deletedCount = 0;
      if (recent.length) {
        const bulk = await interaction.channel.bulkDelete(recent, true).catch(() => null);
        deletedCount += bulk?.size || 0;
      }
      for (const msg of old) { await msg.delete().catch(() => null); deletedCount++; }

      logEvent(guild, {
        type: 'BULK_DELETE', color: 0xed4245, title: '🗑️ ลบข้อความจำนวนมาก',
        fields: [
          { name: 'ลบโดย',   value: `${interaction.user}`,                      inline: true },
          { name: 'จำนวน',   value: `${deletedCount} ข้อความ`,                  inline: true },
          { name: 'Channel', value: `${interaction.channel}`,                   inline: true },
          { name: 'กรองจาก', value: targetUser ? targetUser.tag : 'ทุกคน',      inline: true },
        ],
      });

      return interaction.editReply({
        content: `✅ ลบ **${deletedCount}** ข้อความเรียบร้อย${targetUser ? ` (จาก ${targetUser.tag})` : ''}`,
      });
    }

    // ── /warn ────────────────────────────────────────────
    if (commandName === 'warn') {
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('⚠️ คำเตือน')
            .setDescription(`${target} ได้รับคำเตือน`)
            .addFields(
              { name: 'เหตุผล',   value: reason },
              { name: 'เตือนโดย', value: `${interaction.user}`, inline: true }
            )
            .setColor(0xfee75c)
            .setTimestamp(),
        ],
      });
      await target
        .send({
          embeds: [
            new EmbedBuilder()
              .setTitle(`⚠️ คุณได้รับคำเตือนใน ${guild.name}`)
              .addFields({ name: 'เหตุผล', value: reason })
              .setColor(0xfee75c)
              .setTimestamp(),
          ],
        })
        .catch(() => {});
      logEvent(guild, {
        type: 'WARN', color: 0xfee75c, title: '⚠️ เตือนสมาชิก',
        fields: [
          { name: 'สมาชิก',   value: `${target.tag} (${target.id})`, inline: true },
          { name: 'เหตุผล',   value: reason,                         inline: true },
          { name: 'เตือนโดย', value: `${interaction.user}`,          inline: true },
        ],
      });
      return;
    }

    // ── /timeout ─────────────────────────────────────────
    if (commandName === 'timeout') {
      const target  = interaction.options.getMember('user');
      const minutes = interaction.options.getInteger('minutes');
      const reason  = interaction.options.getString('reason') || 'ไม่ระบุเหตุผล';
      if (!target) return interaction.reply({ content: '❌ ไม่พบสมาชิก', flags: 64 });
      await target.timeout(minutes * 60 * 1000, reason);
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔇 Timeout สมาชิก')
            .addFields(
              { name: 'สมาชิก',   value: target.user.tag,     inline: true },
              { name: 'ระยะเวลา', value: `${minutes} นาที`,   inline: true },
              { name: 'เหตุผล',   value: reason }
            )
            .setColor(0xfee75c)
            .setTimestamp(),
        ],
      });
    }

    // ── /userinfo ────────────────────────────────────────
    if (commandName === 'userinfo') {
      const m     = interaction.options.getMember('user') || member;
      const roles = m.roles.cache
        .filter((r) => r.id !== guild.id)
        .map((r) => `${r}`)
        .join(', ') || 'ไม่มี';
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`👤 ข้อมูลของ ${m.user.username}`)
            .setThumbnail(m.user.displayAvatarURL({ size: 256 }))
            .addFields(
              { name: '🏷️ Tag',    value: m.user.tag,                                                   inline: true },
              { name: '🆔 ID',     value: m.user.id,                                                    inline: true },
              { name: '📅 สร้างบัญชี', value: `<t:${Math.floor(m.user.createdTimestamp / 1000)}:R>`,   inline: true },
              { name: '📥 เข้า Server', value: `<t:${Math.floor(m.joinedTimestamp / 1000)}:R>`,        inline: true },
              { name: '🎭 Roles',  value: roles.slice(0, 1024) }
            )
            .setColor(m.displayColor || 0x5865f2)
            .setTimestamp(),
        ],
      });
    }

    // ── /serverinfo ──────────────────────────────────────
    if (commandName === 'serverinfo') {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`🏠 ${guild.name}`)
            .setThumbnail(guild.iconURL({ size: 256 }))
            .addFields(
              { name: '🆔 Server ID', value: guild.id,              inline: true },
              { name: '👑 เจ้าของ',   value: `<@${guild.ownerId}>`, inline: true },
              { name: '👥 สมาชิก',   value: `${guild.memberCount}`, inline: true },
              { name: '📁 Channels', value: `${guild.channels.cache.size}`, inline: true },
              { name: '🎭 Roles',    value: `${guild.roles.cache.size}`,    inline: true },
              { name: '📅 สร้างเมื่อ', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true }
            )
            .setColor(0x5865f2)
            .setTimestamp(),
        ],
      });
    }

    // ── /help ────────────────────────────────────────────
    if (commandName === 'help') {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('📋 คำสั่งทั้งหมด')
            .setColor(0x5865f2)
            .addFields(
              { name: '🎫 Ticket',                  value: '`/ticket` — สร้าง Ticket Panel' },
              { name: '🎭 Role',                    value: '`/reactionrole` — สร้าง Reaction Role Message' },
              { name: '🔨 Moderation',              value: '`/kick` `/ban` `/unban` `/warn` `/timeout`' },
              { name: '🗑️ Clear (Admin เท่านั้น)', value: '`/clear [จำนวน] [@user]` — ลบข้อความ\nกรองเฉพาะ user ได้ด้วย' },
              { name: 'ℹ️ Info',                   value: '`/userinfo [@user]` `/serverinfo`' }
            )
            .setFooter({ text: 'Server Management Bot' })
            .setTimestamp(),
        ],
        flags: 64,
      });
    }
  });
}

module.exports = { registerInteractions };
