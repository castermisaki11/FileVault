// ============================================================
//  commands.js — Slash Command definitions + registration
// ============================================================
const { SlashCommandBuilder, PermissionFlagsBits, REST, Routes } = require('discord.js');

// setDefaultMemberPermissions(0) = ซ่อนจากทุกคนโดย default
// การตรวจสิทธิ์จริงทำใน interactions.js ผ่าน isStaff()
// ถ้าอยากให้ role ไหนเห็น → ตั้งใน Discord: Server Settings → Integrations → Bot
const STAFF_ONLY = 0;

const commands = [
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('สร้าง คำร้อง ใน channel นี้')
    .setDefaultMemberPermissions(STAFF_ONLY),

  new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('สร้าง Reaction Role Message ใน channel นี้')
    .setDefaultMemberPermissions(STAFF_ONLY),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick สมาชิกออกจาก Server')
    .addUserOption((o) => o.setName('user').setDescription('สมาชิกที่ต้องการ Kick').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('เหตุผล'))
    .setDefaultMemberPermissions(STAFF_ONLY),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban สมาชิกออกจาก Server')
    .addUserOption((o) => o.setName('user').setDescription('สมาชิกที่ต้องการ Ban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('เหตุผล'))
    .setDefaultMemberPermissions(STAFF_ONLY),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('ปลดแบนสมาชิก')
    .addStringOption((o) => o.setName('userid').setDescription('User ID ที่ต้องการปลดแบน').setRequired(true))
    .setDefaultMemberPermissions(STAFF_ONLY),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('ลบข้อความใน channel นี้ [Admin เท่านั้น]')
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('จำนวนข้อความ (1-100)').setMinValue(1).setMaxValue(100).setRequired(true)
    )
    .addUserOption((o) => o.setName('user').setDescription('ลบเฉพาะข้อความของ user นี้ (ไม่บังคับ)'))
    .setDefaultMemberPermissions(STAFF_ONLY),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('เตือนสมาชิก')
    .addUserOption((o) => o.setName('user').setDescription('สมาชิกที่ต้องการเตือน').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('เหตุผล').setRequired(true))
    .setDefaultMemberPermissions(STAFF_ONLY),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout สมาชิก (ห้ามพูด)')
    .addUserOption((o) => o.setName('user').setDescription('สมาชิกที่ต้องการ Timeout').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('minutes').setDescription('จำนวนนาที (1-10080)').setMinValue(1).setMaxValue(10080).setRequired(true)
    )
    .addStringOption((o) => o.setName('reason').setDescription('เหตุผล'))
    .setDefaultMemberPermissions(STAFF_ONLY),

  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('ดูข้อมูลของสมาชิก')
    .addUserOption((o) => o.setName('user').setDescription('สมาชิกที่ต้องการดูข้อมูล'))
    .setDefaultMemberPermissions(STAFF_ONLY),

  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('ดูข้อมูลของ Server')
    .setDefaultMemberPermissions(STAFF_ONLY),

  new SlashCommandBuilder()
    .setName('help2')
    .setDescription('แสดงคำสั่งทั้งหมดของ Bot')
    .setDefaultMemberPermissions(STAFF_ONLY),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN2);
  try {
    console.log('⏳ กำลัง register Slash Commands (Management Bot)...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID2), {
      body: commands.map((c) => c.toJSON()),
    });
    console.log('✅ Register Slash Commands สำเร็จ!');
  } catch (err) {
    console.error('❌ Register commands ล้มเหลว:', err);
  }
}

module.exports = { commands, registerCommands };
