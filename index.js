require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const upload = multer({ dest: path.join(__dirname, 'data') });
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder,
  REST,
  Routes,
} = require('discord.js');
const {
  addRace,
  getLeaderboard,
  getTracks,
  addUpcomingRace,
  getUpcomingRaces,
  importMany,
} = require('./db');

const GAMEHOST_ROLE_NAME = process.env.GAMEHOST_ROLE_NAME || 'GameHost';

function isAdmin(message) {
  return message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
}

const PREFIX = process.env.PREFIX || '!';
const PORT = process.env.PORT || 3000;

// ---------- Discord bot ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
});

// ---------- Slash commands ----------
const slashCommands = [
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show top 10 best times')
    .addStringOption((opt) =>
      opt.setName('track').setDescription('Filter by track name').setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('tracks')
    .setDescription('List all tracks with recorded times'),
  new SlashCommandBuilder()
    .setName('upcomingrace')
    .setDescription('Show upcoming scheduled races'),
  new SlashCommandBuilder()
    .setName('gamehost')
    .setDescription(`Ping the @${GAMEHOST_ROLE_NAME} role to request a host`)
    .addStringOption((opt) =>
      opt.setName('code').setDescription('Private game code').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('addrace')
    .setDescription('[Admin] Schedule an upcoming race')
    .addStringOption((opt) =>
      opt.setName('track').setDescription('Track name').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('date').setDescription('Date, e.g. 2026-09-10').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('time').setDescription('Time, e.g. 18:00').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('note').setDescription('Optional note').setRequired(false)
    )
    .addAttachmentOption((opt) =>
      opt.setName('image').setDescription('Event banner image').setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('importleaderboard')
    .setDescription('[Admin] Bulk import race results from a file in the data/ folder')
    .addStringOption((opt) =>
      opt.setName('filename').setDescription('e.g. results.json or results.csv').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available commands'),
].map((cmd) => cmd.toJSON());

async function registerSlashCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
    console.log('Slash commands registered.');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
}

client.once('ready', () => {
  registerSlashCommands();
});

function formatTime(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(3);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  if (command === 'leaderboard' || command === 'lb') {
    const track = args.join(' ') || null;
    const rows = getLeaderboard(track, 10);

    if (rows.length === 0) {
      return message.reply(
        track
          ? `No race results yet for track **${track}**.`
          : 'No race results recorded yet.'
      );
    }

    const embed = new EmbedBuilder()
      .setTitle(track ? `🏁 Leaderboard — ${track}` : '🏁 Overall Leaderboard (best times)')
      .setColor(0xff5555)
      .setDescription(
        rows
          .map((r, i) => `**${i + 1}.** ${r.player} — \`${formatTime(r.best_time)}\``)
          .join('\n')
      )
      .setFooter({ text: track ? `Track: ${track}` : 'All tracks combined' });

    return message.reply({ embeds: [embed] });
  }

  if (command === 'tracks') {
    const tracks = getTracks();
    if (tracks.length === 0) return message.reply('No tracks recorded yet.');
    return message.reply(`Available tracks: ${tracks.map((t) => `\`${t}\``).join(', ')}`);
  }

  if (command === 'gamehost') {
    const code = args.join(' ').trim();
    if (!code) {
      return message.reply(`Usage: \`${PREFIX}gamehost <private code>\``);
    }

    const role = message.guild.roles.cache.find((r) => r.name === GAMEHOST_ROLE_NAME);
    if (!role) {
      return message.reply(
        `No role named **${GAMEHOST_ROLE_NAME}** found on this server. Ask an admin to create it or set \`GAMEHOST_ROLE_NAME\` in .env.`
      );
    }

    const embed = new EmbedBuilder()
      .setTitle('🎮 Host Requested')
      .setColor(0x5566ff)
      .setDescription(`${message.author} is requesting a host.`)
      .addFields({ name: 'Private Code', value: `\`${code}\`` });

    return message.channel.send({ content: `${role}`, embeds: [embed] });
  }

  if (command === 'upcomingrace' || command === 'upcoming') {
    const races = getUpcomingRaces(5);
    if (races.length === 0) {
      return message.reply('No upcoming races scheduled.');
    }

    const embed = new EmbedBuilder()
      .setTitle('📅 Upcoming Races')
      .setColor(0xffaa00)
      .setDescription(
        races
          .map(
            (r) =>
              `**${r.track}** — ${r.starts_at}${r.note ? `\n${r.note}` : ''}`
          )
          .join('\n\n')
      );

    return message.reply({ embeds: [embed] });
  }

  if (command === 'addrace') {
    if (!isAdmin(message)) {
      return message.reply('You need Administrator permission to use this command.');
    }
    // Usage: !addrace <track> <YYYY-MM-DD> <HH:MM> [note...]
    // Optional: attach an image to the message to use as the event image
    const track = args.shift();
    const date = args.shift();
    const time = args.shift();
    const note = args.join(' ');

    if (!track || !date || !time) {
      return message.reply(
        `Usage: \`${PREFIX}addrace <track> <YYYY-MM-DD> <HH:MM> [note]\` (attach an image to use as the event banner)\n` +
          `Example: \`${PREFIX}addrace mandalika 2026-09-10 18:00 Bring your best car!\``
      );
    }

    const starts_at = `${date} ${time}`;
    if (isNaN(Date.parse(starts_at))) {
      return message.reply('Could not parse that date/time. Use `YYYY-MM-DD HH:MM`.');
    }

    // Normalize to zero-padded ISO-like format so SQLite's datetime()
    // comparisons work correctly (SQLite requires strict padding).
    const parsed = new Date(starts_at.replace(' ', 'T'));
    const pad = (n) => String(n).padStart(2, '0');
    const normalized_starts_at =
      `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ` +
      `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;

    const image_url = message.attachments.first()?.url || null;
    addUpcomingRace({ track, starts_at: normalized_starts_at, note, event_name: track, image_url });
    return message.reply(`✅ Scheduled **${track}** for ${normalized_starts_at}${note ? ` — ${note}` : ''}`);
  }

  if (command === 'importleaderboard') {
    if (!isAdmin(message)) {
      return message.reply('You need Administrator permission to use this command.');
    }
    // Usage: !importleaderboard <filename.json or filename.csv>
    // File must sit in the bot's /data folder
    const filename = args[0];
    if (!filename) {
      return message.reply(
        `Usage: \`${PREFIX}importleaderboard <filename>\`\n` +
          `Place a .json or .csv file in the bot's \`data/\` folder first.\n` +
          `JSON format: \`[{"player":"Alex","track":"mandalika","time_ms":45231}, ...]\`\n` +
          `CSV format: \`player,track,time_ms\` header row followed by rows.`
      );
    }

    const filePath = path.join(__dirname, 'data', filename);
    if (!fs.existsSync(filePath)) {
      return message.reply(`File not found: \`data/${filename}\``);
    }

    try {
      let rows = [];
      const raw = fs.readFileSync(filePath, 'utf8');

      if (filename.endsWith('.json')) {
        rows = JSON.parse(raw);
      } else if (filename.endsWith('.csv')) {
        const lines = raw.trim().split('\n');
        const header = lines[0].split(',').map((h) => h.trim());
        rows = lines.slice(1).map((line) => {
          const cells = line.split(',').map((c) => c.trim());
          const obj = {};
          header.forEach((h, i) => (obj[h] = cells[i]));
          return obj;
        });
      } else {
        return message.reply('Unsupported file type. Use `.json` or `.csv`.');
      }

      const count = importMany(rows);
      return message.reply(`✅ Imported ${count} race result(s) from \`${filename}\`.`);
    } catch (err) {
      console.error('Import failed:', err);
      return message.reply(`Import failed: ${err.message}`);
    }
  }

  if (command === 'help') {
    return message.reply(
      `**Racing Bot Commands**\n` +
        `\`${PREFIX}leaderboard [track]\` — show top 10 best times (optionally filtered by track)\n` +
        `\`${PREFIX}tracks\` — list tracks with recorded times\n` +
        `\`${PREFIX}upcomingrace\` — show scheduled upcoming races\n` +
        `\`${PREFIX}gamehost <code>\` — ping the @${GAMEHOST_ROLE_NAME} role with your private code\n` +
        `**Admin only:**\n` +
        `\`${PREFIX}addrace <track> <YYYY-MM-DD> <HH:MM> [note]\` — schedule a race\n` +
        `\`${PREFIX}importleaderboard <file.json|file.csv>\` — bulk import results from \`data/\` folder`
    );
  }
});

// ---------- Slash command handler ----------
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === 'leaderboard') {
    const track = interaction.options.getString('track');
    const rows = getLeaderboard(track, 10);

    if (rows.length === 0) {
      return interaction.reply(
        track ? `No race results yet for track **${track}**.` : 'No race results recorded yet.'
      );
    }

    const embed = new EmbedBuilder()
      .setTitle(track ? `🏁 Leaderboard — ${track}` : '🏁 Overall Leaderboard (best times)')
      .setColor(0xff5555)
      .setDescription(
        rows.map((r, i) => `**${i + 1}.** ${r.player} — \`${formatTime(r.best_time)}\``).join('\n')
      )
      .setFooter({ text: track ? `Track: ${track}` : 'All tracks combined' });

    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'tracks') {
    const tracks = getTracks();
    if (tracks.length === 0) return interaction.reply('No tracks recorded yet.');
    return interaction.reply(`Available tracks: ${tracks.map((t) => `\`${t}\``).join(', ')}`);
  }

  if (commandName === 'upcomingrace') {
    const races = getUpcomingRaces(5);
    if (races.length === 0) return interaction.reply('No upcoming races scheduled.');

    const embed = new EmbedBuilder()
      .setTitle('📅 Upcoming Races')
      .setColor(0xffaa00)
      .setDescription(
        races.map((r) => `**${r.track}** — ${r.starts_at}${r.note ? `\n${r.note}` : ''}`).join('\n\n')
      );
    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'gamehost') {
    const code = interaction.options.getString('code');
    const role = interaction.guild.roles.cache.find((r) => r.name === GAMEHOST_ROLE_NAME);
    if (!role) {
      return interaction.reply(
        `No role named **${GAMEHOST_ROLE_NAME}** found. Ask an admin to create it or set \`GAMEHOST_ROLE_NAME\` in .env.`
      );
    }
    const embed = new EmbedBuilder()
      .setTitle('🎮 Host Requested')
      .setColor(0x5566ff)
      .setDescription(`${interaction.user} is requesting a host.`)
      .addFields({ name: 'Private Code', value: `\`${code}\`` });

    return interaction.reply({ content: `${role}`, embeds: [embed] });
  }

  if (commandName === 'addrace') {
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'You need Administrator permission to use this.', ephemeral: true });
    }
    const track = interaction.options.getString('track');
    const date = interaction.options.getString('date');
    const time = interaction.options.getString('time');
    const note = interaction.options.getString('note') || '';
    const imageAttachment = interaction.options.getAttachment('image');

    const starts_at = `${date} ${time}`;
    if (isNaN(Date.parse(starts_at))) {
      return interaction.reply({ content: 'Could not parse that date/time. Use `YYYY-MM-DD` and `HH:MM`.', ephemeral: true });
    }

    const parsed = new Date(starts_at.replace(' ', 'T'));
    const pad = (n) => String(n).padStart(2, '0');
    const normalized_starts_at =
      `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ` +
      `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;

    addUpcomingRace({
      track,
      starts_at: normalized_starts_at,
      note,
      event_name: track,
      image_url: imageAttachment?.url || null,
    });

    return interaction.reply(`✅ Scheduled **${track}** for ${normalized_starts_at}${note ? ` — ${note}` : ''}`);
  }

  if (commandName === 'importleaderboard') {
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'You need Administrator permission to use this.', ephemeral: true });
    }
    const filename = interaction.options.getString('filename');
    const filePath = path.join(__dirname, 'data', filename);
    if (!fs.existsSync(filePath)) {
      return interaction.reply({ content: `File not found: \`data/${filename}\``, ephemeral: true });
    }

    try {
      let rows = [];
      const raw = fs.readFileSync(filePath, 'utf8');
      if (filename.endsWith('.json')) {
        rows = JSON.parse(raw);
      } else if (filename.endsWith('.csv')) {
        const lines = raw.trim().split('\n');
        const header = lines[0].split(',').map((h) => h.trim());
        rows = lines.slice(1).map((line) => {
          const cells = line.split(',').map((c) => c.trim());
          const obj = {};
          header.forEach((h, i) => (obj[h] = cells[i]));
          return obj;
        });
      } else {
        return interaction.reply({ content: 'Unsupported file type. Use `.json` or `.csv`.', ephemeral: true });
      }
      const count = importMany(rows);
      return interaction.reply(`✅ Imported ${count} race result(s) from \`${filename}\`.`);
    } catch (err) {
      return interaction.reply({ content: `Import failed: ${err.message}`, ephemeral: true });
    }
  }

  if (commandName === 'help') {
    return interaction.reply(
      `**Racing Bot Commands**\n` +
        `\`/leaderboard [track]\` — show top 10 best times\n` +
        `\`/tracks\` — list tracks with recorded times\n` +
        `\`/upcomingrace\` — show scheduled upcoming races\n` +
        `\`/gamehost <code>\` — ping @${GAMEHOST_ROLE_NAME} with your private code\n` +
        `**Admin only:**\n` +
        `\`/addrace <track> <date> <time> [note] [image]\` — schedule a race\n` +
        `\`/importleaderboard <filename>\` — bulk import from \`data/\` folder\n\n` +
        `_(Old \`!\` text commands still work too.)_`
    );
  }
});

client.login(process.env.DISCORD_TOKEN);

// ---------- HTTP server (Roblox -> here) ----------
const app = express();
app.use(express.json());

// CORS so your website's frontend JS can fetch this from a browser
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-admin-password, x-api-secret');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- Public read-only endpoints (no secret needed) ----------
// GET /api/leaderboard            -> top 10 overall
// GET /api/leaderboard?track=X    -> top 10 for track X
// GET /api/leaderboard?limit=25   -> custom limit
app.get('/api/leaderboard', (req, res) => {
  const track = req.query.track || null;
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
  const rows = getLeaderboard(track, limit);
  res.json({ track, count: rows.length, leaderboard: rows });
});

app.get('/api/tracks', (req, res) => {
  res.json({ tracks: getTracks() });
});

// Public: upcoming races, for the website countdown section
app.get('/api/upcoming', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
  const races = getUpcomingRaces(limit);
  res.json({ races });
});

// Simple auth so random people can't post fake results to your bot
// (scoped to just this route, not applied globally to everything after it)
function requireApiSecret(req, res, next) {
  const secret = req.header('x-api-secret');
  if (secret !== process.env.API_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// Roblox posts here after a race finishes:
// { "player": "PlayerName", "track": "Track1", "time_ms": 45231 }
app.post('/race-result', requireApiSecret, async (req, res) => {
  const { player, track, time_ms } = req.body;

  if (!player || !track || !Number.isFinite(time_ms)) {
    return res.status(400).json({ error: 'player, track, and time_ms (number) are required' });
  }

  addRace({ player, track, time_ms });

  // Announce live in Discord
  const channelId = process.env.ANNOUNCE_CHANNEL_ID;
  if (channelId) {
    try {
      const channel = await client.channels.fetch(channelId);
      const embed = new EmbedBuilder()
        .setTitle('🏁 Race Finished!')
        .setColor(0x55ff55)
        .addFields(
          { name: 'Player', value: player, inline: true },
          { name: 'Track', value: track, inline: true },
          { name: 'Time', value: formatTime(time_ms), inline: true }
        );
      channel.send({ embeds: [embed] });
    } catch (err) {
      console.error('Failed to announce race result:', err.message);
    }
  }

  res.json({ success: true });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ---------- Admin Dashboard ----------
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-too',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
}));

function requireLogin(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  // Allow cross-origin clients (like the Astro admin page) to authenticate
  // via header instead of a shared session cookie.
  const headerPass = req.header('x-admin-password');
  if (headerPass && headerPass === process.env.ADMIN_PASSWORD) return next();
  return res.status(401).json({ error: 'not logged in' });
}

app.post('/admin/login', express.json(), (req, res) => {
  const { password } = req.body;
  if (password && password === process.env.ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'wrong password' });
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/admin/session', (req, res) => {
  res.json({ loggedIn: !!(req.session && req.session.loggedIn) });
});

// Data endpoints (all require login)
app.get('/admin/api/leaderboard', requireLogin, (req, res) => {
  const track = req.query.track || null;
  res.json({ leaderboard: getLeaderboard(track, 50) });
});

app.get('/admin/api/tracks', requireLogin, (req, res) => {
  res.json({ tracks: getTracks() });
});

app.get('/admin/api/upcoming', requireLogin, (req, res) => {
  res.json({ races: getUpcomingRaces(20) });
});

app.post('/admin/api/addrace', requireLogin, express.json(), (req, res) => {
  const { track, starts_at, note, event_name, image_url } = req.body;
  if (!track || !starts_at) {
    return res.status(400).json({ error: 'track and starts_at are required' });
  }
  if (isNaN(Date.parse(starts_at))) {
    return res.status(400).json({ error: 'invalid starts_at date/time' });
  }

  const parsed = new Date(starts_at.replace(' ', 'T'));
  const pad = (n) => String(n).padStart(2, '0');
  const normalized_starts_at =
    `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ` +
    `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;

  addUpcomingRace({ track, starts_at: normalized_starts_at, note: note || null, event_name: event_name || track, image_url: image_url || null });
  res.json({ success: true });
});

app.post('/admin/api/addresult', requireLogin, express.json(), (req, res) => {
  const { player, track, time_ms } = req.body;
  if (!player || !track || !Number.isFinite(Number(time_ms))) {
    return res.status(400).json({ error: 'player, track, time_ms are required' });
  }
  addRace({ player, track, time_ms: Number(time_ms) });
  res.json({ success: true });
});

app.post('/admin/api/import', requireLogin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  try {
    const raw = fs.readFileSync(req.file.path, 'utf8');
    let rows = [];
    if (req.file.originalname.endsWith('.json')) {
      rows = JSON.parse(raw);
    } else if (req.file.originalname.endsWith('.csv')) {
      const lines = raw.trim().split('\n');
      const header = lines[0].split(',').map((h) => h.trim());
      rows = lines.slice(1).map((line) => {
        const cells = line.split(',').map((c) => c.trim());
        const obj = {};
        header.forEach((h, i) => (obj[h] = cells[i]));
        return obj;
      });
    } else {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'unsupported file type, use .json or .csv' });
    }
    const count = importMany(rows);
    fs.unlinkSync(req.file.path);
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/api/gamehost', requireLogin, express.json(), async (req, res) => {
  const { guildId, code, requester } = req.body;
  if (!guildId || !code) {
    return res.status(400).json({ error: 'guildId and code are required' });
  }
  try {
    const guild = await client.guilds.fetch(guildId);
    const role = guild.roles.cache.find((r) => r.name === GAMEHOST_ROLE_NAME);
    if (!role) return res.status(404).json({ error: `role ${GAMEHOST_ROLE_NAME} not found` });

    const channelId = process.env.ANNOUNCE_CHANNEL_ID;
    const channel = await client.channels.fetch(channelId);
    const embed = new EmbedBuilder()
      .setTitle('🎮 Host Requested (via Dashboard)')
      .setColor(0x5566ff)
      .setDescription(`${requester || 'A dashboard admin'} is requesting a host.`)
      .addFields({ name: 'Private Code', value: `\`${code}\`` });

    await channel.send({ content: `${role}`, embeds: [embed] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/admin/api/guildid', requireLogin, (req, res) => {
  const ids = client.guilds.cache.map((g) => ({ id: g.id, name: g.name }));
  res.json({ guilds: ids });
});

app.use('/admin', express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
  console.log(`Roblox should POST to: http://<your-ngrok-url>/race-result`);
});