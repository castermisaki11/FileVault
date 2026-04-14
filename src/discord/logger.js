// ============================================================
//  logger.js — Server event logging
// ============================================================
const { EmbedBuilder } = require('discord.js');
const { CONFIG } = require('./config');

// ── Core log function ────────────────────────────────────────
async function logEvent(guild, { type, color, title, fields = [], description = '', image = null, files = [] }) {
  const logChannel = guild.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: `Event: ${type}` });

  if (description) embed.setDescription(description);
  if (fields.length) embed.addFields(fields);
  if (image) embed.setImage(image);

  await logChannel.send({ embeds: [embed], files }).catch(console.error);
}

// ── Attachment helpers ───────────────────────────────────────
const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','webp','bmp','avif','svg','heic']);

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
}

function isImageAtt(att) {
  const ext = (att.name || att.url || '').split('.').pop().split('?')[0].toLowerCase();
  return IMAGE_EXTS.has(ext) || (att.contentType || '').startsWith('image/');
}

// สร้าง fields + image preview จาก attachments
function buildAttachmentInfo(attachments) {
  if (!attachments || attachments.size === 0) return { attachFields: [], previewImage: null };

  const list   = [...attachments.values()];
  const images = list.filter(isImageAtt);
  const others = list.filter(a => !isImageAtt(a));

  const attachFields = [];

  if (images.length) {
    attachFields.push({
      name: `🖼️ รูปภาพ (${images.length})`,
      value: images.map(a => `[\`${a.name}\`](${a.url}) — ${formatSize(a.size)}`).join('\n').slice(0, 1024),
    });
  }
  if (others.length) {
    attachFields.push({
      name: `📎 ไฟล์แนบ (${others.length})`,
      value: others.map(a => `[\`${a.name}\`](${a.url}) — ${formatSize(a.size)}`).join('\n').slice(0, 1024),
    });
  }

  return { attachFields, previewImage: images[0]?.url || null };
}

// ── Register all log events ──────────────────────────────────
function registerLogEvents(client) {

  // ── สมาชิกเข้า ──────────────────────────────────────────
  client.on('guildMemberAdd', (m) => logEvent(m.guild, {
    type: 'MEMBER_JOIN', color: 0x57f287, title: '👋 สมาชิกใหม่เข้า Server',
    fields: [
      { name: 'สมาชิก',          value: `${m} (${m.id})`,                                      inline: true },
      { name: 'บัญชีสร้างเมื่อ', value: `<t:${Math.floor(m.user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: 'จำนวนสมาชิก',     value: `${m.guild.memberCount}`,                              inline: true },
    ],
  }));

  // ── สมาชิกออก ───────────────────────────────────────────
  client.on('guildMemberRemove', (m) => logEvent(m.guild, {
    type: 'MEMBER_LEAVE', color: 0xfee75c, title: '🚪 สมาชิกออก Server',
    fields: [
      { name: 'สมาชิก',        value: `${m.user.tag} (${m.id})`,                        inline: true },
      { name: 'อยู่ใน Server', value: `<t:${Math.floor(m.joinedTimestamp / 1000)}:R>`,  inline: true },
    ],
  }));

  // ── ส่งไฟล์/รูป (messageCreate) ─────────────────────────
  client.on('messageCreate', async (msg) => {
    if (msg.author?.bot) return;
    if (!msg.attachments.size) return;
    if (msg.channel.id === CONFIG.LOG_CHANNEL_ID) return;

    const list    = [...msg.attachments.values()];
    const images  = list.filter(isImageAtt);
    const others  = list.filter(a => !isImageAtt(a));
    const total   = list.reduce((s, a) => s + (a.size || 0), 0);

    const title = images.length && others.length ? '📤 อัปโหลดรูป + ไฟล์'
                : images.length                  ? '🖼️ อัปโหลดรูปภาพ'
                :                                  '📤 อัปโหลดไฟล์';

    const { attachFields, previewImage } = buildAttachmentInfo(msg.attachments);

    logEvent(msg.guild, {
      type: 'FILE_UPLOAD',
      color: 0x5865f2,
      title,
      image: previewImage,
      fields: [
        { name: 'ผู้ส่ง',   value: `${msg.author} (${msg.author.id})`,                 inline: true },
        { name: 'Channel', value: `${msg.channel}`,                                    inline: true },
        { name: 'จำนวน',   value: `${list.length} ไฟล์ · ${formatSize(total)}`,       inline: true },
        ...attachFields,
        ...(msg.content ? [{ name: 'ข้อความ', value: msg.content.slice(0, 512) }] : []),
      ],
    });
  });

  // ── ลบข้อความ ────────────────────────────────────────────
  client.on('messageDelete', async (msg) => {
    if (msg.author?.bot) return;
    if (msg.channel.id === CONFIG.LOG_CHANNEL_ID) return;

    const hasAtt = msg.attachments?.size > 0;
    const { attachFields, previewImage } = hasAtt
      ? buildAttachmentInfo(msg.attachments)
      : { attachFields: [], previewImage: null };

    const fields = [
      { name: 'ผู้ส่ง',   value: msg.author ? `${msg.author} (${msg.author.id})` : 'ไม่ทราบ', inline: true },
      { name: 'Channel', value: `${msg.channel}`,                                               inline: true },
    ];
    if (msg.content) fields.push({ name: 'ข้อความ', value: msg.content.slice(0, 1024) });
    if (hasAtt)      fields.push(...attachFields);

    logEvent(msg.guild, {
      type: 'MESSAGE_DELETE',
      color: 0xed4245,
      title: hasAtt ? '🗑️ ลบข้อความ (มีไฟล์แนบ)' : '🗑️ ลบข้อความ',
      image: previewImage,
      fields,
    });
  });

  // ── แก้ไขข้อความ ─────────────────────────────────────────
  client.on('messageUpdate', async (o, n) => {
    if (o.author?.bot) return;
    if (o.content === n.content) return;
    if (o.channel.id === CONFIG.LOG_CHANNEL_ID) return;

    // ตรวจ attachment ที่เพิ่มมาหรือถูกลบออก
    const addedAtt   = n.attachments.filter(a => !o.attachments.has(a.id));
    const removedAtt = o.attachments.filter(a => !n.attachments.has(a.id));
    const { attachFields: addedFields }   = buildAttachmentInfo(addedAtt);
    const { attachFields: removedFields } = buildAttachmentInfo(removedAtt);

    const fields = [
      { name: 'ผู้ส่ง',     value: `${o.author} (${o.author.id})`, inline: true },
      { name: 'Channel',   value: `${o.channel}`,                  inline: true },
      { name: 'ก่อนแก้ไข', value: o.content?.slice(0, 512) || '*ไม่มี*' },
      { name: 'หลังแก้ไข', value: n.content?.slice(0, 512) || '*ไม่มี*' },
    ];
    if (addedFields.length)   fields.push({ name: '➕ ไฟล์แนบใหม่',    value: addedFields.map(f => f.value).join('\n').slice(0, 512) });
    if (removedFields.length) fields.push({ name: '➖ ไฟล์แนบที่ลบออก', value: removedFields.map(f => f.value).join('\n').slice(0, 512) });

    logEvent(o.guild, {
      type: 'MESSAGE_EDIT', color: 0xfee75c, title: '✏️ แก้ไขข้อความ',
      fields,
    });
  });

  // ── แบน / ปลดแบน ─────────────────────────────────────────
  client.on('guildBanAdd', (ban) => logEvent(ban.guild, {
    type: 'MEMBER_BAN', color: 0xed4245, title: '🔨 แบนสมาชิก',
    fields: [
      { name: 'สมาชิก', value: `${ban.user.tag} (${ban.user.id})`, inline: true },
      { name: 'เหตุผล', value: ban.reason || 'ไม่ระบุ',            inline: true },
    ],
  }));

  client.on('guildBanRemove', (ban) => logEvent(ban.guild, {
    type: 'MEMBER_UNBAN', color: 0x57f287, title: '✅ ปลดแบนสมาชิก',
    fields: [{ name: 'สมาชิก', value: `${ban.user.tag} (${ban.user.id})`, inline: true }],
  }));

  // ── สร้าง / ลบ Channel ───────────────────────────────────
  client.on('channelCreate', (ch) => logEvent(ch.guild, {
    type: 'CHANNEL_CREATE', color: 0x57f287, title: '📁 สร้าง Channel ใหม่',
    fields: [{ name: 'Channel', value: `${ch} (${ch.name})`, inline: true }],
  }));

  client.on('channelDelete', (ch) => logEvent(ch.guild, {
    type: 'CHANNEL_DELETE', color: 0xed4245, title: '🗑️ ลบ Channel',
    fields: [{ name: 'ชื่อ', value: ch.name, inline: true }],
  }));
}

module.exports = { logEvent, registerLogEvents };
