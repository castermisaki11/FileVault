// ============================================================
//  ticket.js — Ticket System
//  🐛 FIX: ตรวจสอบ TICKET_CATEGORY_ID ว่าเป็น GuildCategory จริงๆ
//          ก่อนสร้าง channel เพื่อป้องกัน CHANNEL_PARENT_INVALID_TYPE
// ============================================================
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const { CONFIG, isStaff } = require('./config');
const { logEvent } = require('./logger');
const db = require('../core/db');

// ── In-memory cache (sync กับ DB) ──────────────────────────
// Map userId → { channelId, ticketNumber, isUrgent, openedAt }
const openTickets = new Map();

// โหลด open tickets จาก DB ตอน bot เริ่มต้น
async function loadOpenTickets() {
  try {
    const rows = await db.getFileEvents({ eventType: 'ticket_open', limit: 500 });
    const closedRows = await db.getFileEvents({ eventType: 'ticket_close', limit: 500 });
    const closedChannels = new Set(closedRows.map(r => r.meta?.channelId).filter(Boolean));
    for (const row of rows) {
      const { userId, channelId } = row.meta || {};
      if (userId && channelId && !closedChannels.has(channelId)) {
        openTickets.set(userId, { channelId, ticketNumber: row.meta.ticketNumber, openedAt: row.created_at });
      }
    }
    if (openTickets.size) console.log(`🎫 [tickets] Restored ${openTickets.size} open tickets from DB`);
  } catch (e) {
    console.warn('⚠ [tickets] Could not load from DB:', e.message);
  }
}

// เรียกตอน bot ready
loadOpenTickets();

// ── helpers ────────────────────────────────────────────────

/**
 * ✅ FIX: ดึง category channel และตรวจว่าเป็น GuildCategory จริง
 * ถ้าไม่ใช่ → throw error พร้อมข้อความชัดเจน
 */
function resolveCategory(guild) {
  const cat = guild.channels.cache.get(CONFIG.TICKET_CATEGORY_ID);
  if (!cat) {
    throw new Error(
      `❌ ไม่พบ Channel ID: ${CONFIG.TICKET_CATEGORY_ID}\n` +
      `กรุณาตั้งค่า TICKET_CATEGORY_ID ใน .env ให้ถูกต้อง`
    );
  }
  if (cat.type !== ChannelType.GuildCategory) {
    throw new Error(
      `❌ Channel "${cat.name}" (${cat.id}) ไม่ใช่ Category!\n` +
      `ต้องการ Channel Type: GuildCategory แต่ได้รับ type ${cat.type}\n` +
      `วิธีแก้: ใน Discord → คลิกขวาที่ Category → Copy ID → ใส่ใน TICKET_CATEGORY_ID`
    );
  }
  return cat;
}

// ── Ticket Panel ────────────────────────────────────────────

async function createTicketPanel(channel) {
  const embed = new EmbedBuilder()
    .setTitle('🎫  ระบบแจ้งปัญหา')
    .setDescription(
      '**ต้องการความช่วยเหลือ?**\n' +
      'กดปุ่มด้านล่างเพื่อเปิดคำร้อง\n' +
      'ทีมงานจะตอบกลับโดยเร็วที่สุด 🙏'
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'กรุณาอธิบายปัญหาอย่างละเอียดเมื่อคำร้องถูกเปิด' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_open')
      .setLabel('เปิดคำร้อง')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎫'),
    new ButtonBuilder()
      .setCustomId('ticket_open_urgent')
      .setLabel('เร่งด่วน')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🚨')
  );

  await channel.send({ embeds: [embed], components: [row] });
}

// ── Open Ticket ─────────────────────────────────────────────

async function handleTicketOpen(interaction, isUrgent = false) {
  const userId = interaction.user.id;
  const guild  = interaction.guild;

  // ตรวจ ticket ที่เปิดอยู่แล้ว
  if (openTickets.has(userId)) {
    const cached = openTickets.get(userId);
    const existing = guild.channels.cache.get(cached.channelId || cached);
    if (existing)
      return interaction.reply({ content: `❌ คุณมีคำร้องที่เปิดอยู่แล้ว: ${existing}`, flags: 64 });
    openTickets.delete(userId); // ห้องถูกลบไปแล้ว — ล้าง map
  }

  await interaction.deferReply({ flags: 64 });

  try {
    resolveCategory(guild);

    const ticketNumber  = Date.now().toString().slice(-6);
    const ticketChannel = await guild.channels.create({
      name: `คำร้อง-${interaction.user.username}-${ticketNumber}`,
      type: ChannelType.GuildText,
      parent: CONFIG.TICKET_CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.id,            deny:  [PermissionFlagsBits.ViewChannel] },
        { id: userId,              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: CONFIG.STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
      ],
    });

    // อัปเดต in-memory cache
    openTickets.set(userId, { channelId: ticketChannel.id, ticketNumber, isUrgent, openedAt: new Date() });

    // บันทึกลง DB
    await db.logFileEvent({
      eventType: 'ticket_open',
      fileName:  ticketChannel.name,
      folder:    'discord/tickets',
      meta:      { userId, channelId: ticketChannel.id, ticketNumber, isUrgent, userTag: interaction.user.tag },
    });

    const embed = new EmbedBuilder()
      .setTitle(`${isUrgent ? '🚨 คำร้องเร่งด่วน' : '🎫 คำร้อง'} #${ticketNumber}`)
      .setDescription(
        `สวัสดี ${interaction.user}!\n` +
        `ทีมงาน <@&${CONFIG.STAFF_ROLE_ID}> จะมาช่วยเร็วๆนี้\n\n` +
        `**กรุณาอธิบายปัญหาของคุณ:**`
      )
      .setColor(isUrgent ? 0xed4245 : 0x57f287)
      .addFields(
        { name: '👤 ผู้แจ้ง',  value: `${interaction.user}`,                    inline: true },
        { name: '📅 วันที่',  value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
        { name: '⚡ ระดับ',   value: isUrgent ? '🚨 เร่งด่วน' : '📋 ปกติ',    inline: true }
      )
      .setThumbnail(interaction.user.displayAvatarURL())
      .setTimestamp();

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_close').setLabel('ปิดคำร้อง').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
      new ButtonBuilder().setCustomId('ticket_claim').setLabel('รับคำร้อง').setStyle(ButtonStyle.Success).setEmoji('✋')
    );

    await ticketChannel.send({
      content: `${interaction.user} | <@&${CONFIG.STAFF_ROLE_ID}>`,
      embeds: [embed],
      components: [closeRow],
    });

    logEvent(guild, {
      type: 'TICKET_OPEN', color: 0x57f287, title: '🎫 เปิดคำร้องใหม่',
      fields: [
        { name: 'ผู้แจ้ง',  value: `${interaction.user} (${interaction.user.id})`, inline: true },
        { name: 'ห้อง',    value: `${ticketChannel}`,                              inline: true },
        { name: 'ระดับ',   value: isUrgent ? '🚨 เร่งด่วน' : '📋 ปกติ',          inline: true },
      ],
    });

    await interaction.editReply({ content: `✅ เปิดคำร้องสำเร็จ! ${ticketChannel}` });
  } catch (err) {
    console.error('[คำร้อง] เกิดข้อผิดพลาด:', err.message);
    await interaction.editReply({ content: err.message || '❌ เกิดข้อผิดพลาดในการเปิดคำร้อง' });
  }
}

// ── Transcript → Cloudflare R2 ──────────────────────────────

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/**
 * ดึงข้อความทั้งหมดใน ticket channel → อัปโหลด .txt ขึ้น R2
 * folder: logs/discord/<ชื่อห้อง>-<timestamp>.txt
 * แล้วส่ง embed พร้อม link ไปยัง LOG_CHANNEL
 */
async function sendTranscript(channel, closedBy, guild) {
  const logChannel = guild.channels.cache.get(CONFIG.LOG_CHANNEL_IDTICK);

  // ── ดึงข้อความ (สูงสุด 500 รายการ) ──
  const allMessages = [];
  let lastId = null;

  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;
    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;
    allMessages.push(...batch.values());
    lastId = batch.last().id;
    if (batch.size < 100 || allMessages.length >= 500) break;
  }

  allMessages.reverse(); // เก่า → ใหม่

  // ── สร้างเนื้อหาไฟล์ ──
  const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  const lines = [
    `═══════════════════════════════════════`,
    `  บันทึกการสนทนา`,
    `  ห้อง    : ${channel.name}`,
    `  ปิดโดย  : ${closedBy.tag} (${closedBy.id})`,
    `  วันที่   : ${now}`,
    `  ข้อความ  : ${allMessages.length} รายการ`,
    `═══════════════════════════════════════`,
    '',
  ];

  for (const msg of allMessages) {
    const time        = new Date(msg.createdTimestamp).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    const content     = msg.content || '';
    const attachments = msg.attachments.map((a) => `[ไฟล์แนบ: ${a.url}]`).join(' ');
    const embeds      = msg.embeds.length ? `[Embed: ${msg.embeds.length} รายการ]` : '';
    const parts       = [content, attachments, embeds].filter(Boolean).join(' ');
    lines.push(`[${time}] ${msg.author.tag}: ${parts || '*(ไม่มีข้อความ)*'}`);
  }

  lines.push('', `═══════════════════════════════════════`);

  const fileContent = lines.join('\n');
  const timestamp   = Date.now();
  const r2Key       = `logs/discord/${channel.name}-${timestamp}.txt`;
  const publicUrl   = process.env.R2_PUBLIC_URL
    ? `${process.env.R2_PUBLIC_URL}/${r2Key}`
    : null;

  // ── อัปโหลดขึ้น R2 ──
  let uploadedKey = null;
  try {
    await r2.send(new PutObjectCommand({
      Bucket:      process.env.R2_BUCKET,
      Key:         r2Key,
      Body:        Buffer.from(fileContent, 'utf8'),
      ContentType: 'text/plain; charset=utf-8',
    }));
    uploadedKey = r2Key;
    console.log(`[R2] อัปโหลด transcript สำเร็จ: ${r2Key}`);
  } catch (err) {
    console.error('[R2] อัปโหลด transcript ล้มเหลว:', err.message);
  }

  // ── ส่ง embed แจ้งใน log channel ──
  if (!logChannel) return uploadedKey;

  const embed = new EmbedBuilder()
    .setTitle('📄 บันทึกการสนทนา')
    .addFields(
      { name: 'ห้อง',     value: channel.name,                  inline: true },
      { name: 'ปิดโดย',  value: `${closedBy}`,                  inline: true },
      { name: 'ข้อความ', value: `${allMessages.length} รายการ`, inline: true },
      { name: '📁 ไฟล์ R2', value: `\`${r2Key}\`` },
    )
    .setColor(0x5865f2)
    .setTimestamp();

  if (publicUrl) embed.addFields({ name: '🔗 ลิงก์', value: publicUrl });

  await logChannel.send({ embeds: [embed] }).catch(console.error);
  return uploadedKey;
}

// ── Close Ticket ────────────────────────────────────────────

async function handleTicketClose(interaction) {
  const channel = interaction.channel;
  if (!channel.name.startsWith('คำร้อง-'))
    return interaction.reply({ content: '❌ ใช้ได้เฉพาะในห้องคำร้องเท่านั้น', flags: 64 });

  await interaction.deferReply();

  // อัปเดต in-memory cache
  let ticketUserId = null;
  for (const [uid, info] of openTickets.entries()) {
    const cid = typeof info === 'object' ? info.channelId : info;
    if (cid === channel.id) { ticketUserId = uid; openTickets.delete(uid); break; }
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('🔒 คำร้องถูกปิดแล้ว')
        .setDescription(`ปิดโดย ${interaction.user}\n...\nห้องนี้จะถูกลบใน **5 วินาที**`)
        .setColor(0xed4245)
        .setTimestamp(),
    ],
  });

  // บันทึก transcript ก่อนลบห้อง
  const r2Key = await sendTranscript(channel, interaction.user, interaction.guild);

  // บันทึก ticket_close ลง DB
  await db.logFileEvent({
    eventType: 'ticket_close',
    fileName:  channel.name,
    folder:    'discord/tickets',
    meta:      {
      channelId:  channel.id,
      closedById: interaction.user.id,
      closedByTag: interaction.user.tag,
      userId:     ticketUserId,
      transcriptKey: r2Key || null,
    },
  }).catch(() => {});

  logEvent(interaction.guild, {
    type: 'TICKET_CLOSE', color: 0xed4245, title: '🔒 ปิดคำร้อง',
    fields: [
      { name: 'ห้อง',   value: channel.name,          inline: true },
      { name: 'ปิดโดย', value: `${interaction.user}`, inline: true },
    ],
  });

  setTimeout(() => channel.delete().catch(console.error), 5000);
}

// ── Claim Ticket ────────────────────────────────────────────

async function handleTicketClaim(interaction) {
  if (!isStaff(interaction.member))
    return interaction.reply({ content: '❌ เฉพาะทีมงานเท่านั้น', flags: 64 });
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setDescription(`✋ **${interaction.user.username}** รับคำร้องนี้แล้ว`)
        .setColor(0xfee75c),
    ],
  });
}

module.exports = {
  createTicketPanel,
  handleTicketOpen,
  handleTicketClose,
  handleTicketClaim,
};
