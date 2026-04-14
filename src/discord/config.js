// ============================================================
//  config.js — Shared config + permission helpers
// ============================================================
const { PermissionFlagsBits } = require('discord.js');

const CONFIG = {
  TICKET_CATEGORY_ID:       process.env.TICKET_CATEGORY_ID        || 'YOUR_CATEGORY_ID',
  STAFF_ROLE_ID:            process.env.STAFF_ROLE_ID              || 'YOUR_STAFF_ROLE_ID',
  ADMIN_ROLE_ID:            process.env.ADMIN_ROLE_ID              || 'YOUR_ADMIN_ROLE_ID',

  REACTION_ROLE_MESSAGE_ID: process.env.REACTION_ROLE_MESSAGE_ID   || 'YOUR_MESSAGE_ID',
  REACTION_ROLES: {
    '🎮': process.env.ROLE_GAMER || 'ROLE_ID_GAMER',
    '👾': process.env.ROLE_BOT   || 'ROLE_ID_BOT',
    '🎵': process.env.ROLE_NOT   || 'ROLE_ID_NOT',
    '🌟': process.env.ROLE_VIP   || 'ROLE_ID_VIP',
  },

  LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID || 'YOUR_LOG_CHANNEL_ID',
  LOG_CHANNEL_IDTICK: process.env.LOG_CHANNEL_IDTICK || 'YOUR_LOG_CHANNEL_ID',
};

function isAdmin(member) {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)
  );
}

function isStaff(member) {
  return isAdmin(member) || member.roles.cache.has(CONFIG.STAFF_ROLE_ID);
}

module.exports = { CONFIG, isAdmin, isStaff };
