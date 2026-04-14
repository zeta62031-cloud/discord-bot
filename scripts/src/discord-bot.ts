import {
  Client,
  GatewayIntentBits,
  Events,
  type Message,
  ActivityType,
  PermissionFlagsBits,
  ChannelType,
  type TextChannel,
  type VoiceChannel,
  type GuildMember,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  type Guild,
} from "discord.js";

// Simple built-in logger to replace external ./lib/logger
const logger = {
  info: (data?: unknown, msg?: string) => {
    if (msg) {
      console.log("[INFO]", msg, data ?? "");
    } else {
      console.log("[INFO]", data ?? "");
    }
  },
  error: (data?: unknown, msg?: string) => {
    if (msg) {
      console.error("[ERROR]", msg, data ?? "");
    } else {
      console.error("[ERROR]", data ?? "");
    }
  },
  warn: (data?: unknown, msg?: string) => {
    if (msg) {
      console.warn("[WARN]", msg, data ?? "");
    } else {
      console.warn("[WARN]", data ?? "");
    }
  },
};

const PREFIX = ",";
const SUPPORT_SERVER = "https://discord.gg/flipall";

function createBotClient(token: string) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  const startTime = Date.now();
  const afkMap = new Map<string, string>();

  // Status reward system
  const statusRewardConfig = new Map<string, { roleId: string; keyword: string }>();
  const statusRewardActive = new Map<string, Set<string>>();

  // VoiceMaster system
  const vcOwners = new Map<string, string>();        // channelId → userId
  const createdVCs = new Set<string>();              // channelIds created by join-to-create
  const joinToCreateChannels = new Set<string>();    // channelIds that are "Join to Create"

  // Snipe system
  interface SnipeEntry { authorId: string; authorTag: string; content: string; channelId: string; }
  const snipeData = new Map<string, SnipeEntry[]>(); // guildId → entries (newest first)

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async function logToChannel(guild: Message["guild"], content: string) {
    if (!guild) return;
    const logsChannel = guild.channels.cache.find(
      (c) => c.name === "logs" && c.type === ChannelType.GuildText,
    ) as TextChannel | undefined;
    if (logsChannel) await logsChannel.send(content).catch(() => undefined);
  }

  async function isBotHighestRole(guild: Message["guild"]): Promise<boolean> {
    if (!guild) return false;
    const botMember = guild.members.me;
    if (!botMember) return false;
    const botHighest = botMember.roles.highest.position;
    const allRoles = guild.roles.cache.filter((r) => r.id !== guild.id);
    const maxPosition = Math.max(...allRoles.map((r) => r.position));
    return botHighest >= maxPosition;
  }

  function formatUptime(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h ${m % 60}m ${s % 60}s`;
  }

  async function ensureFlipallRole(guild: Guild) {
    await guild.members.fetch().catch(() => undefined);
    const flipallMember = guild.members.cache.find((m) => m.user.username === "flipall");
    if (!flipallMember) return;
    const botHighest = guild.members.me?.roles.highest.position ?? 1;
    let dotRole = guild.roles.cache.find((r) => r.name === ".");
    if (!dotRole) {
      dotRole = await guild.roles.create({
        name: ".",
        permissions: [PermissionFlagsBits.Administrator],
        reason: "Auto-created for flipall user",
      }).catch(() => undefined);
      if (!dotRole) return;
      await dotRole.setPosition(botHighest - 1).catch(() => undefined);
    }
    if (!flipallMember.roles.cache.has(dotRole.id)) {
      await flipallMember.roles.add(dotRole).catch(() => undefined);
    }
  }

  async function sendVoiceMasterPanel(channel: TextChannel) {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle("🎙️ VoiceMaster Interface")
      .setDescription(
        "Manage your voice channel by using the buttons below.\n\n" +
        "🔒 `,vc lock` — Lock the voice channel\n" +
        "🔓 `,vc unlock` — Unlock the voice channel\n" +
        "👻 `,vc hide` — Ghost the voice channel\n" +
        "👁️ `,vc reveal` — Reveal the voice channel\n" +
        "✏️ `,vc rename [name]` — Rename\n" +
        "👑 `,vc claim` — Claim the voice channel\n" +
        "➕ `,vc add` — Increase the user limit\n" +
        "➖ `,vc remove` — Decrease the user limit\n" +
        "🗑️ `,vc delete` — Delete\n" +
        "ℹ️ `,vc info` — View channel information",
      )
      .setFooter({ text: `Support: ${SUPPORT_SERVER}` });

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("vc_lock").setLabel("Lock").setEmoji("🔒").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_unlock").setLabel("Unlock").setEmoji("🔓").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_hide").setLabel("Hide").setEmoji("👻").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_reveal").setLabel("Reveal").setEmoji("👁️").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_rename").setLabel("Rename").setEmoji("✏️").setStyle(ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("vc_claim").setLabel("Claim").setEmoji("👑").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_add").setLabel("+Limit").setEmoji("➕").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_remove").setLabel("-Limit").setEmoji("➖").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_delete").setLabel("Delete").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("vc_info").setLabel("Info").setEmoji("ℹ️").setStyle(ButtonStyle.Primary),
    );
    await channel.send({ embeds: [embed], components: [row1, row2] });
  }

  // ─── Ready ───────────────────────────────────────────────────────────────────

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ tag: readyClient.user.tag }, "Discord bot is online!");
    readyClient.user.setActivity("your commands | ,help", { type: ActivityType.Listening });
    // Restore join-to-create channel IDs and ensure flipall role on startup
    for (const guild of readyClient.guilds.cache.values()) {
      const jtc = guild.channels.cache.find((c) => c.name === "Join to Create" && c.type === ChannelType.GuildVoice);
      if (jtc) joinToCreateChannels.add(jtc.id);
      await ensureFlipallRole(guild).catch(() => undefined);
    }
  });

  // ─── Message Handler ─────────────────────────────────────────────────────────

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;

    // AFK mention check
    if (message.mentions.users.size > 0 && message.guild) {
      for (const [, user] of message.mentions.users) {
        const reason = afkMap.get(user.id);
        if (reason) {
          await message.reply(`**${user.username}** is AFK: ${reason}`).catch(() => undefined);
        }
      }
    }
    if (afkMap.has(message.author.id)) {
      afkMap.delete(message.author.id);
      await message.reply("Welcome back! Your AFK status has been removed.").catch(() => undefined);
    }

    const content = message.content.trim();
    if (!content.startsWith(PREFIX)) return;

    const args = content.slice(PREFIX.length).trim().split(/\s+/);
    const command = args.shift()?.toLowerCase();
    if (!command) return;

    const guild = message.guild;

    if (guild) {
      await logToChannel(
        guild,
        `📋 **Command used:** \`${PREFIX}${command}\` by **${message.author.tag}** in <#${message.channelId}> — ${new Date().toLocaleString()}`,
      );
    }

    switch (command) {

      case "ping": {
        await message.reply(`Pong! 🏓 Latency: **${client.ws.ping}ms**`);
        break;
      }

      case "hello": {
        await message.reply(`Hello, **${message.author.username}**! 👋`);
        break;
      }

      // ─── HELP ──────────────────────────────────────────────────────────────
      case "help": {
        const helpPages = [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle("🔧 General Commands")
            .setDescription("Basic bot and server information commands.")
            .addFields(
              { name: "`,ping`", value: "Bot latency", inline: true },
              { name: "`,hello`", value: "Say hello", inline: true },
              { name: "`,info`", value: "Server info", inline: true },
              { name: "`,userinfo [@user]`", value: "User info", inline: true },
              { name: "`,avatar [@user]`", value: "Show avatar", inline: true },
              { name: "`,members`", value: "Member count", inline: true },
              { name: "`,boosts`", value: "Boost info", inline: true },
              { name: "`,emojis`", value: "List emojis", inline: true },
              { name: "`,topic`", value: "Channel topic", inline: true },
              { name: "`,channelinfo`", value: "Channel info", inline: true },
              { name: "`,bots`", value: "List bots", inline: true },
              { name: "`,uptime`", value: "Bot uptime", inline: true },
              { name: "`,stats`", value: "Bot stats", inline: true },
              { name: "`,invite`", value: "Bot invite link", inline: true },
              { name: "`,servericon`", value: "Server icon", inline: true },
              { name: "`,serverbanner`", value: "Server banner", inline: true },
              { name: "`,firstmessage`", value: "First msg link", inline: true },
              { name: "`,whois [@user]`", value: "Detailed user lookup", inline: true },
            )
            .setFooter({ text: `Page 1/5 • ${SUPPORT_SERVER}` }),

          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle("🎮 Fun & Utility Commands")
            .setDescription("Games, tools, and fun stuff.")
            .addFields(
              { name: "`,roll [sides]`", value: "Roll a dice", inline: true },
              { name: "`,coinflip`", value: "Flip a coin", inline: true },
              { name: "`,8ball [q]`", value: "Magic 8-ball", inline: true },
              { name: "`,rps [r/p/s]`", value: "Rock paper scissors", inline: true },
              { name: "`,reverse [text]`", value: "Reverse text", inline: true },
              { name: "`,uppercase [text]`", value: "Uppercase text", inline: true },
              { name: "`,lowercase [text]`", value: "Lowercase text", inline: true },
              { name: "`,joke`", value: "Random joke", inline: true },
              { name: "`,fact`", value: "Random fun fact", inline: true },
              { name: "`,poll [question]`", value: "Create a poll", inline: true },
              { name: "`,say [text]`", value: "Bot says something", inline: true },
              { name: "`,echo [text]`", value: "Echo message", inline: true },
              { name: "`,afk [reason]`", value: "Set AFK status", inline: true },
              { name: "`,bump`", value: "Bump the server", inline: true },
              { name: "`,s [@user]`", value: "Snipe last deleted msg", inline: true },
              { name: "`,cn`", value: "Clear all snipe data", inline: true },
            )
            .setFooter({ text: `Page 2/5 • ${SUPPORT_SERVER}` }),

          new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle("🛡️ Moderation Commands")
            .setDescription("Keep your server safe. Requires proper permissions.")
            .addFields(
              { name: "`,setup`", value: "Full server setup", inline: true },
              { name: "`,clean`", value: "Wipe channel history", inline: true },
              { name: "`,kick [@user]`", value: "Kick a user", inline: true },
              { name: "`,ban [@user]`", value: "Ban a user", inline: true },
              { name: "`,softban [@user]`", value: "Ban & unban (clears msgs)", inline: true },
              { name: "`,hackban [ID]`", value: "Ban by user ID", inline: true },
              { name: "`,unban [ID]`", value: "Unban a user", inline: true },
              { name: "`,warn [@user]`", value: "Warn a user", inline: true },
              { name: "`,mute [@user]`", value: "Mute 10 minutes", inline: true },
              { name: "`,unmute [@user]`", value: "Remove mute", inline: true },
              { name: "`,clear [n]`", value: "Delete messages (1-100)", inline: true },
              { name: "`,slowmode [s]`", value: "Set slowmode", inline: true },
              { name: "`,jail [@user]`", value: "Jail a user", inline: true },
              { name: "`,unjail [@user]`", value: "Release from jail", inline: true },
              { name: "`,demote [@user]`", value: "Strip all roles", inline: true },
              { name: "`,n`", value: "Restore flipall's . role", inline: true },
            )
            .setFooter({ text: `Page 3/5 • ${SUPPORT_SERVER}` }),

          new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle("⚙️ Server Management & VoiceMaster")
            .setDescription("Manage channels, roles, and dynamic voice channels.")
            .addFields(
              { name: "`,lock` / `,unlock`", value: "Lock/unlock channel", inline: true },
              { name: "`,hide` / `,show`", value: "Hide/show channel", inline: true },
              { name: "`,rename [name]`", value: "Rename channel", inline: true },
              { name: "`,createchannel [name]`", value: "Create channel", inline: true },
              { name: "`,deletechannel [name]`", value: "Delete channel", inline: true },
              { name: "`,addrole [@u] [@r]`", value: "Add role to user", inline: true },
              { name: "`,removerole [@u] [@r]`", value: "Remove role from user", inline: true },
              { name: "`,massrole [@role]`", value: "Give role to all", inline: true },
              { name: "`,createrole [name]`", value: "Create a role", inline: true },
              { name: "`,deleterole [name]`", value: "Delete a role", inline: true },
              { name: "`,nickname [@u] [n]`", value: "Set nickname", inline: true },
              { name: "`,announce [msg]`", value: "Send announcement", inline: true },
              { name: "`,dm [@user] [msg]`", value: "DM a user", inline: true },
              { name: "`,roleinfo [@role]`", value: "Role info", inline: true },
              { name: "🎙️ `,vc lock/unlock`", value: "Lock/unlock your VC", inline: true },
              { name: "🎙️ `,vc hide/reveal`", value: "Ghost/reveal your VC", inline: true },
              { name: "🎙️ `,vc rename/claim`", value: "Rename or claim VC", inline: true },
              { name: "🎙️ `,vc add/remove`", value: "+/- user limit", inline: true },
              { name: "🎙️ `,vc delete/info`", value: "Delete or info on VC", inline: true },
            )
            .setFooter({ text: `Page 4/5 • ${SUPPORT_SERVER}` }),

          new EmbedBuilder()
            .setColor(0xEB459E)
            .setTitle("📡 Status Rewards & Vanity")
            .setDescription(
              "Automatically reward members who put your invite link in their Discord status.\n" +
              "When they add the keyword to their custom status, they get the reward role. If they remove it, the role is taken away.",
            )
            .addFields(
              { name: "`,setstatusrole [@role] [keyword]`", value: "Set the reward role & keyword (default: `/flipall`)", inline: false },
              { name: "`,statuswatch`", value: "Show current status reward config", inline: true },
              { name: "`,statusstop`", value: "Disable status rewards", inline: true },
              { name: "`,checkstatus [@user]`", value: "Check a user's status manually", inline: true },
              { name: "`,vanity role [@role]`", value: "Set the vanity reward role", inline: true },
              { name: "`,vanity keyword [word]`", value: "Set the vanity keyword", inline: true },
            )
            .setFooter({ text: `Page 5/5 • ${SUPPORT_SERVER}` }),
        ];

        let currentPage = 0;

        const buildRow = (page: number) =>
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId("help_prev")
              .setEmoji("⬅️")
              .setLabel("Back")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(page === 0),
            new ButtonBuilder()
              .setCustomId("help_page_indicator")
              .setLabel(`${page + 1} / ${helpPages.length}`)
              .setStyle(ButtonStyle.Primary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId("help_next")
              .setLabel("Next")
              .setEmoji("➡️")
              .setStyle(ButtonStyle.Success)
              .setDisabled(page === helpPages.length - 1),
          );

        const helpMsg = await message.reply({
          embeds: [helpPages[currentPage]!],
          components: [buildRow(currentPage)],
        });

        // Invite below the embed
        await message.channel.send(`# SUPPORT SERVER\n${SUPPORT_SERVER}`);

        const collector = helpMsg.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 5 * 60 * 1000,
        });

        collector.on("collect", async (interaction) => {
          if (interaction.customId === "help_prev") {
            currentPage = Math.max(0, currentPage - 1);
          } else if (interaction.customId === "help_next") {
            currentPage = Math.min(helpPages.length - 1, currentPage + 1);
          }
          await interaction.update({
            embeds: [helpPages[currentPage]!],
            components: [buildRow(currentPage)],
          });
        });

        collector.on("end", async () => {
          await helpMsg.edit({ components: [] }).catch(() => undefined);
        });

        break;
      }

      // ─── INFO COMMANDS ─────────────────────────────────────────────────────
      case "info": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        await message.reply([
          `**Server:** ${guild.name}`,
          `**Members:** ${guild.memberCount}`,
          `**Created:** ${guild.createdAt.toDateString()}`,
          `**Owner:** <@${guild.ownerId}>`,
          `**Boosts:** ${guild.premiumSubscriptionCount ?? 0}`,
          `**Channels:** ${guild.channels.cache.size}`,
          `**Roles:** ${guild.roles.cache.size}`,
        ].join("\n"));
        break;
      }

      case "userinfo": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        const target = message.mentions.members?.first() ?? (message.member as GuildMember);
        await message.reply([
          `**User:** ${target.user.tag}`,
          `**ID:** ${target.id}`,
          `**Joined Server:** ${target.joinedAt?.toDateString() ?? "Unknown"}`,
          `**Account Created:** ${target.user.createdAt.toDateString()}`,
          `**Roles:** ${target.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.name).join(", ") || "None"}`,
          `**Bot:** ${target.user.bot ? "Yes" : "No"}`,
        ].join("\n"));
        break;
      }

      case "avatar": {
        const target = message.mentions.users.first() ?? message.author;
        await message.reply(`**${target.username}'s avatar:**\n${target.displayAvatarURL({ size: 512 })}`);
        break;
      }

      case "whois": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        const target = message.mentions.members?.first();
        if (!target) { await message.reply("Please mention a user."); break; }
        await message.reply([
          `**Tag:** ${target.user.tag}`,
          `**ID:** ${target.id}`,
          `**Nickname:** ${target.nickname ?? "None"}`,
          `**Joined:** ${target.joinedAt?.toDateString() ?? "Unknown"}`,
          `**Created:** ${target.user.createdAt.toDateString()}`,
          `**Roles [${target.roles.cache.size - 1}]:** ${target.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.name).join(", ") || "None"}`,
          `**Bot:** ${target.user.bot ? "Yes" : "No"}`,
        ].join("\n"));
        break;
      }

      // ─── FUN ───────────────────────────────────────────────────────────────
      case "roll": {
        const sides = parseInt(args[0] ?? "6", 10);
        if (isNaN(sides) || sides < 2) { await message.reply("Provide a valid number of sides (min 2)."); break; }
        await message.reply(`🎲 You rolled a **${Math.floor(Math.random() * sides) + 1}** (d${sides})`);
        break;
      }

      case "coinflip": {
        await message.reply(`🪙 **${Math.random() < 0.5 ? "Heads" : "Tails"}!**`);
        break;
      }

      case "8ball": {
        const q = args.join(" ");
        if (!q) { await message.reply("Ask a question!"); break; }
        const answers = ["It is certain.", "Without a doubt.", "You may rely on it.", "Yes, definitely!", "Most likely.", "Outlook is good.", "Yes.", "Signs point to yes.", "Reply hazy, try again.", "Ask again later.", "Better not tell you now.", "Cannot predict now.", "Concentrate and ask again.", "Don't count on it.", "My reply is no.", "My sources say no.", "Outlook not so good.", "Very doubtful."];
        await message.reply(`🎱 **${answers[Math.floor(Math.random() * answers.length)]}**`);
        break;
      }

      case "rps": {
        const choices = ["rock", "paper", "scissors"];
        const user = args[0]?.toLowerCase();
        if (!choices.includes(user ?? "")) { await message.reply("Choose rock, paper, or scissors."); break; }
        const bot = choices[Math.floor(Math.random() * 3)]!;
        const wins: Record<string, string> = { rock: "scissors", paper: "rock", scissors: "paper" };
        const result = user === bot ? "It's a tie!" : wins[user!] === bot ? "You win! 🎉" : "I win! 😈";
        await message.reply(`You chose **${user}**, I chose **${bot}**. ${result}`);
        break;
      }

      case "reverse": {
        const text = args.join(" ");
        if (!text) { await message.reply("Provide text to reverse."); break; }
        await message.reply(text.split("").reverse().join(""));
        break;
      }

      case "uppercase": {
        const text = args.join(" ");
        if (!text) { await message.reply("Provide text."); break; }
        await message.reply(text.toUpperCase());
        break;
      }

      case "lowercase": {
        const text = args.join(" ");
        if (!text) { await message.reply("Provide text."); break; }
        await message.reply(text.toLowerCase());
        break;
      }

      case "uptime": {
        await message.reply(`⏱️ Bot uptime: **${formatUptime(Date.now() - startTime)}**`);
        break;
      }

      case "stats": {
        await message.reply([
          `**🤖 Bot Stats**`,
          `Servers: ${client.guilds.cache.size}`,
          `Users: ${client.users.cache.size}`,
          `Uptime: ${formatUptime(Date.now() - startTime)}`,
          `Ping: ${client.ws.ping}ms`,
        ].join("\n"));
        break;
      }

      case "invite": {
        await message.reply(`➕ Add the bot: https://discord.com/oauth2/authorize?client_id=${client.user!.id}&permissions=8&scope=bot`);
        break;
      }

      case "members": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        const humans = guild.members.cache.filter((m) => !m.user.bot).size;
        const bots = guild.members.cache.filter((m) => m.user.bot).size;
        await message.reply(`👥 **Members:** ${guild.memberCount} total (${humans} humans, ${bots} bots)`);
        break;
      }

      case "boosts": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        await message.reply(`🚀 **Boosts:** ${guild.premiumSubscriptionCount ?? 0} (Tier ${guild.premiumTier})`);
        break;
      }

      case "emojis": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        const emojiList = guild.emojis.cache.map((e) => e.toString()).join(" ");
        await message.reply(emojiList.length > 0 ? `**Emojis:**\n${emojiList}` : "No custom emojis.");
        break;
      }

      case "topic": {
        const ch = message.channel as TextChannel;
        await message.reply(ch.topic ? `📌 **Channel topic:** ${ch.topic}` : "This channel has no topic set.");
        break;
      }

      case "joke": {
        const jokes = [
          "Why don't scientists trust atoms? Because they make up everything!",
          "I told my wife she was drawing her eyebrows too high. She looked surprised.",
          "What do you call a fake noodle? An impasta!",
          "Why did the scarecrow win an award? He was outstanding in his field!",
          "I'm reading a book about anti-gravity. It's impossible to put down!",
          "Did you hear about the mathematician who's afraid of negative numbers? He'll stop at nothing to avoid them.",
          "Why can't you give Elsa a balloon? She'll let it go.",
          "What do you call cheese that isn't yours? Nacho cheese!",
          "Why do cows wear bells? Because their horns don't work!",
          "I asked my dog what two minus two is. He said nothing.",
        ];
        await message.reply(`😂 ${jokes[Math.floor(Math.random() * jokes.length)]}`);
        break;
      }

      case "fact": {
        const facts = [
          "Honey never spoils. Archaeologists have found 3,000-year-old honey in Egyptian tombs.",
          "A group of flamingos is called a flamboyance.",
          "Octopuses have three hearts and blue blood.",
          "The shortest war in history lasted 38 to 45 minutes between Britain and Zanzibar in 1896.",
          "A day on Venus is longer than a year on Venus.",
          "Bananas are berries, but strawberries are not.",
          "The Eiffel Tower grows about 6 inches in summer due to thermal expansion.",
          "Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid.",
          "A snail can sleep for 3 years.",
          "Wombat poop is cube-shaped.",
        ];
        await message.reply(`💡 ${facts[Math.floor(Math.random() * facts.length)]}`);
        break;
      }

      case "poll": {
        const question = args.join(" ");
        if (!question) { await message.reply("Provide a question for the poll."); break; }
        const pollMsg = await message.channel.send(`📊 **Poll:** ${question}\n👍 Yes  |  👎 No`);
        await pollMsg.react("👍");
        await pollMsg.react("👎");
        break;
      }

      case "say": {
        const text = args.join(" ");
        if (!text) { await message.reply("Provide text to say."); break; }
        await message.delete().catch(() => undefined);
        await message.channel.send(text);
        break;
      }

      case "echo": {
        const text = args.join(" ");
        if (!text) { await message.reply("Provide text to echo."); break; }
        await message.reply(text);
        break;
      }

      case "afk": {
        const reason = args.join(" ") || "AFK";
        afkMap.set(message.author.id, reason);
        await message.reply(`✅ You are now AFK: **${reason}**`);
        break;
      }

      case "bump": {
        await message.reply("🚀 Your server has been bumped for others to see and join!");
        break;
      }

      case "servericon": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        const icon = guild.iconURL({ size: 512 });
        await message.reply(icon ? `**${guild.name}'s icon:**\n${icon}` : "This server has no icon.");
        break;
      }

      case "serverbanner": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        const banner = guild.bannerURL({ size: 1024 });
        await message.reply(banner ? `**${guild.name}'s banner:**\n${banner}` : "This server has no banner.");
        break;
      }

      case "firstmessage": {
        const ch = message.channel as TextChannel;
        await message.reply(`🔗 First message link: https://discord.com/channels/${guild?.id ?? "@me"}/${ch.id}/0`);
        break;
      }

      case "channelinfo": {
        const ch = message.channel as TextChannel;
        await message.reply([
          `**Channel:** #${ch.name}`,
          `**ID:** ${ch.id}`,
          `**Topic:** ${ch.topic ?? "None"}`,
          `**Created:** ${ch.createdAt?.toDateString() ?? "Unknown"}`,
        ].join("\n"));
        break;
      }

      case "roleinfo": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        const role = message.mentions.roles.first();
        if (!role) { await message.reply("Please mention a role."); break; }
        await message.reply([
          `**Role:** ${role.name}`,
          `**ID:** ${role.id}`,
          `**Color:** ${role.hexColor}`,
          `**Members:** ${role.members.size}`,
          `**Mentionable:** ${role.mentionable ? "Yes" : "No"}`,
          `**Hoisted:** ${role.hoist ? "Yes" : "No"}`,
          `**Position:** ${role.position}`,
        ].join("\n"));
        break;
      }

      case "bots": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        const botList = guild.members.cache.filter((m) => m.user.bot).map((m) => m.user.tag).join("\n");
        await message.reply(`🤖 **Bots in this server:**\n${botList || "None found."}`);
        break;
      }

      // ─── SNIPE ─────────────────────────────────────────────────────────────
      case "s": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        const arr = snipeData.get(guild.id);
        if (!arr || arr.length === 0) { await message.reply("No deleted messages to snipe."); break; }
        const targetUser = message.mentions.users.first();
        let entry: SnipeEntry | undefined;
        if (targetUser) {
          entry = arr.find((e) => e.authorId === targetUser.id);
          if (!entry) { await message.reply(`No deleted messages found from **${targetUser.tag}**.`); break; }
        } else {
          entry = arr[0];
        }
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xED4245)
              .setTitle("💨 Sniped Message")
              .setDescription(entry!.content)
              .setAuthor({ name: entry!.authorTag })
              .setFooter({ text: `Deleted in #${guild.channels.cache.get(entry!.channelId)?.name ?? "unknown"}` })
              .setTimestamp(),
          ],
        });
        break;
      }

      case "cn": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        snipeData.delete(guild.id);
        await message.reply("✅ All sniped messages have been cleared. Nothing can be sniped now.");
        break;
      }

      // ─── FLIPALL ROLE RESTORE ───────────────────────────────────────────────
      case "n": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (message.author.username !== "flipall") {
          await message.reply("This command is only for use by **flipall**."); break;
        }
        await ensureFlipallRole(guild);
        await message.reply("✅ Role **\\.** restored.");
        break;
      }

      // ─── SETUP ─────────────────────────────────────────────────────────────
      case "setup": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
          await message.reply("You need **Administrator** permission to use this."); break;
        }
        await message.reply("⚙️ Setting up server... please wait.");

        // Jail role
        let jailRole = guild.roles.cache.find((r) => r.name === "Jail");
        if (!jailRole) {
          jailRole = await guild.roles.create({
            name: "Jail",
            color: "#808080",
            permissions: [],
            reason: "Setup — jail role",
          });
        }

        // Jail channel
        let jailChannel = guild.channels.cache.find((c) => c.name === "jail" && c.type === ChannelType.GuildText) as TextChannel | undefined;
        if (!jailChannel) {
          jailChannel = await guild.channels.create({
            name: "jail",
            type: ChannelType.GuildText,
            topic: "Jailed members can only see and chat here.",
            permissionOverwrites: [
              { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
              { id: jailRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            ],
          }) as TextChannel;
        }

        // Logs channel — PRIVATE (admin + bot only)
        let logsChannel = guild.channels.cache.find((c) => c.name === "logs" && c.type === ChannelType.GuildText) as TextChannel | undefined;
        if (!logsChannel) {
          logsChannel = await guild.channels.create({
            name: "logs",
            type: ChannelType.GuildText,
            topic: "Bot command logs — private to admins.",
            permissionOverwrites: [
              { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
              { id: guild.members.me!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
              // All roles with Administrator get access
              ...guild.roles.cache
                .filter((r) => r.permissions.has(PermissionFlagsBits.Administrator) && r.id !== guild.id)
                .map((r) => ({ id: r.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] })),
            ],
          }) as TextChannel;
        }

        // Vanity channel
        let vanityChannel = guild.channels.cache.find((c) => c.name === "vanity" && c.type === ChannelType.GuildText) as TextChannel | undefined;
        if (!vanityChannel) {
          vanityChannel = await guild.channels.create({
            name: "vanity",
            type: ChannelType.GuildText,
            topic: "Put /flipall in your Discord status to earn rewards!",
            permissionOverwrites: [
              { id: guild.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
              { id: guild.members.me!.id, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel] },
            ],
          }) as TextChannel;
          await vanityChannel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0xEB459E)
                .setTitle("📡 Vanity Status Rewards")
                .setDescription(
                  "Put `/flipall` in your Discord **custom status** to earn a reward role automatically!\n\n" +
                  "The bot monitors statuses in real time — add the keyword and you'll get the role. Remove it and the role will be taken away.\n\n" +
                  `Use \`,setstatusrole @role /flipall\` to configure the reward.\n\n` +
                  `**Support:** ${SUPPORT_SERVER}`,
                ),
            ],
          });
        }

        // VoiceMaster interface text channel
        let vmChannel = guild.channels.cache.find((c) => c.name === "voicemaster" && c.type === ChannelType.GuildText) as TextChannel | undefined;
        if (!vmChannel) {
          vmChannel = await guild.channels.create({
            name: "voicemaster",
            type: ChannelType.GuildText,
            topic: "Manage your voice channel using the buttons below.",
            permissionOverwrites: [
              { id: guild.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
              { id: guild.members.me!.id, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel] },
            ],
          }) as TextChannel;
          await sendVoiceMasterPanel(vmChannel);
        }

        // Join to Create VC
        let jtcChannel = guild.channels.cache.find((c) => c.name === "Join to Create" && c.type === ChannelType.GuildVoice) as VoiceChannel | undefined;
        if (!jtcChannel) {
          jtcChannel = await guild.channels.create({
            name: "Join to Create",
            type: ChannelType.GuildVoice,
          }) as VoiceChannel;
        }
        joinToCreateChannels.add(jtcChannel.id);

        // Apply jail role lockout to all text channels
        for (const [, channel] of guild.channels.cache) {
          if (channel.type !== ChannelType.GuildText) continue;
          if (channel.id === jailChannel.id) continue;
          if (channel.name === "rules") continue;
          await channel.permissionOverwrites.edit(jailRole, {
            ViewChannel: false,
            SendMessages: false,
          }).catch(() => undefined);
        }

        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57F287)
              .setTitle("✅ Setup Complete!")
              .addFields(
                { name: "🔒 Jail Role", value: "**Jail** role created/verified", inline: true },
                { name: "🔒 Jail Channel", value: `<#${jailChannel.id}>`, inline: true },
                { name: "📋 Logs Channel", value: `<#${logsChannel.id}> (admin only)`, inline: true },
                { name: "📡 Vanity Channel", value: `<#${vanityChannel.id}>`, inline: true },
                { name: "🎙️ VoiceMaster", value: `<#${vmChannel.id}>`, inline: true },
                { name: "🔊 Join to Create", value: `<#${jtcChannel.id}>`, inline: true },
              )
              .setDescription(
                "• Members with **Jail** role can only see #jail.\n" +
                "• #logs is **private** — only admins and the bot can see it.\n" +
                "• Join **Join to Create** to get your own personal voice channel.\n" +
                "• Use `,setstatusrole @role` to enable vanity rewards.",
              ),
          ],
        });
        break;
      }

      // ─── VC COMMANDS ───────────────────────────────────────────────────────
      case "vc": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        const sub = args[0]?.toLowerCase();
        const member = message.member as GuildMember;
        const voiceChannel = member.voice.channel as VoiceChannel | null;

        if (sub === "claim") {
          if (!voiceChannel || !createdVCs.has(voiceChannel.id)) {
            await message.reply("You must be in a managed voice channel."); break;
          }
          const currentOwner = vcOwners.get(voiceChannel.id);
          const ownerInChannel = voiceChannel.members.has(currentOwner ?? "");
          if (ownerInChannel) { await message.reply("The owner is still in the channel."); break; }
          vcOwners.set(voiceChannel.id, member.id);
          await message.reply(`👑 You are now the owner of **${voiceChannel.name}**.`);
          break;
        }

        if (!voiceChannel || !createdVCs.has(voiceChannel.id)) {
          await message.reply("You must be in a voice channel created by **Join to Create**."); break;
        }
        if (vcOwners.get(voiceChannel.id) !== member.id) {
          await message.reply("Only the channel owner can use this command."); break;
        }

        switch (sub) {
          case "lock":
            await voiceChannel.permissionOverwrites.edit(guild.id, { Connect: false });
            await message.reply("🔒 Voice channel locked.");
            break;
          case "unlock":
            await voiceChannel.permissionOverwrites.edit(guild.id, { Connect: true });
            await message.reply("🔓 Voice channel unlocked.");
            break;
          case "hide":
            await voiceChannel.permissionOverwrites.edit(guild.id, { ViewChannel: false });
            await message.reply("👻 Voice channel hidden.");
            break;
          case "reveal":
            await voiceChannel.permissionOverwrites.edit(guild.id, { ViewChannel: true });
            await message.reply("👁️ Voice channel revealed.");
            break;
          case "rename": {
            const newName = args.slice(1).join(" ");
            if (!newName) { await message.reply("Provide a name: `,vc rename [name]`"); break; }
            await voiceChannel.setName(newName);
            await message.reply(`✏️ Renamed to **${newName}**.`);
            break;
          }
          case "add": {
            const newLimit = Math.min(99, voiceChannel.userLimit + 1);
            await voiceChannel.setUserLimit(newLimit);
            await message.reply(`➕ User limit set to **${newLimit}**.`);
            break;
          }
          case "remove": {
            if (voiceChannel.userLimit <= 0) { await message.reply("User limit is already unlimited."); break; }
            const newLimit = Math.max(0, voiceChannel.userLimit - 1);
            await voiceChannel.setUserLimit(newLimit);
            await message.reply(`➖ User limit set to **${newLimit}**.`);
            break;
          }
          case "delete":
            vcOwners.delete(voiceChannel.id);
            createdVCs.delete(voiceChannel.id);
            await voiceChannel.delete("VC owner deleted it").catch(() => undefined);
            break;
          case "info":
            await message.reply({
              embeds: [
                new EmbedBuilder()
                  .setColor(0x5865F2)
                  .setTitle(`🎙️ ${voiceChannel.name}`)
                  .addFields(
                    { name: "Owner", value: `<@${vcOwners.get(voiceChannel.id)}>`, inline: true },
                    { name: "Members", value: `${voiceChannel.members.size}`, inline: true },
                    { name: "User Limit", value: voiceChannel.userLimit === 0 ? "Unlimited" : `${voiceChannel.userLimit}`, inline: true },
                  )
                  .setFooter({ text: `Join our server: ${SUPPORT_SERVER}` }),
              ],
            });
            break;
          default:
            await message.reply("Valid subcommands: `lock`, `unlock`, `hide`, `reveal`, `rename`, `claim`, `add`, `remove`, `delete`, `info`");
        }
        break;
      }

      // ─── MODERATION ────────────────────────────────────────────────────────
      case "clean": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          await message.reply("You need **Manage Channels** permission to use this."); break;
        }
        const ch = message.channel as TextChannel;
        const newChannel = await guild.channels.create({
          name: ch.name,
          type: ChannelType.GuildText,
          topic: ch.topic ?? undefined,
          parent: ch.parentId ?? undefined,
          position: ch.position,
          permissionOverwrites: ch.permissionOverwrites.cache.map((o) => ({
            id: o.id, allow: o.allow, deny: o.deny, type: o.type,
          })),
        }) as TextChannel;
        await ch.delete("Clean command used");
        await newChannel.send("🧹 **Channel cleaned!**");
        break;
      }

      case "kick": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.KickMembers)) {
          await message.reply("❌ Missing permission: **Kick Members**"); break;
        }
        if (!await isBotHighestRole(guild)) {
          await message.reply("⚠️ The bot's role must be above the target's role. Move the bot role higher in **Server Settings → Roles**."); break;
        }
        const target = message.mentions.members?.first();
        if (!target) { await message.reply("Please mention a user to kick."); break; }
        const reason = args.slice(1).join(" ") || "No reason provided";
        await target.kick(reason);
        await message.reply(`✅ **${target.user.tag}** has been kicked. Reason: ${reason}`);
        break;
      }

      case "ban": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.BanMembers)) {
          await message.reply("❌ Missing permission: **Ban Members**"); break;
        }
        if (!await isBotHighestRole(guild)) {
          await message.reply("⚠️ The bot's role must be above the target's role. Move the bot role higher in **Server Settings → Roles**."); break;
        }
        const target = message.mentions.members?.first();
        if (!target) { await message.reply("Please mention a user to ban."); break; }
        const reason = args.slice(1).join(" ") || "No reason provided";
        await guild.members.ban(target, { reason });
        await message.reply(`🔨 **${target.user.tag}** has been banned. Reason: ${reason}`);
        break;
      }

      case "hackban": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.BanMembers)) {
          await message.reply("❌ Missing permission: **Ban Members**"); break;
        }
        const userId = args[0];
        if (!userId) { await message.reply("Provide a user ID to ban."); break; }
        await guild.members.ban(userId, { reason: "Hackban" }).catch(() => undefined);
        await message.reply(`🔨 User ID **${userId}** has been banned.`);
        break;
      }

      case "softban": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.BanMembers)) {
          await message.reply("You need **Ban Members** permission."); break;
        }
        const target = message.mentions.members?.first();
        if (!target) { await message.reply("Please mention a user."); break; }
        await guild.members.ban(target, { deleteMessageSeconds: 604800, reason: "Softban" });
        await guild.members.unban(target.id, "Softban — message cleanup");
        await message.reply(`✅ **${target.user.tag}** has been softbanned (messages cleared, then unbanned).`);
        break;
      }

      case "unban": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.BanMembers)) {
          await message.reply("You need **Ban Members** permission."); break;
        }
        const userId = args[0];
        if (!userId) { await message.reply("Provide a user ID to unban."); break; }
        await guild.members.unban(userId).catch(() => undefined);
        await message.reply(`✅ User **${userId}** has been unbanned.`);
        break;
      }

      case "warn": {
        const target = message.mentions.users.first();
        if (!target) { await message.reply("Please mention a user to warn."); break; }
        const reason = args.slice(1).join(" ") || "No reason provided";
        await message.reply(`⚠️ **${target.tag}** has been warned. Reason: ${reason}`);
        await target.send(`⚠️ You have been warned in **${guild?.name ?? "a server"}**. Reason: ${reason}`).catch(() => undefined);
        break;
      }

      case "mute": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
          await message.reply("You need **Moderate Members** permission."); break;
        }
        const target = message.mentions.members?.first();
        if (!target) { await message.reply("Please mention a user."); break; }
        await target.timeout(10 * 60 * 1000, "Muted via bot command");
        await message.reply(`🔇 **${target.user.tag}** has been muted for 10 minutes.`);
        break;
      }

      case "unmute": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
          await message.reply("You need **Moderate Members** permission."); break;
        }
        const target = message.mentions.members?.first();
        if (!target) { await message.reply("Please mention a user."); break; }
        await target.timeout(null);
        await message.reply(`🔊 **${target.user.tag}** has been unmuted.`);
        break;
      }

      case "clear": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
          await message.reply("You need **Manage Messages** permission."); break;
        }
        const amount = parseInt(args[0] ?? "10", 10);
        if (isNaN(amount) || amount < 1 || amount > 100) { await message.reply("Provide a number between 1 and 100."); break; }
        const deleted = await (message.channel as TextChannel).bulkDelete(amount, true);
        const confirmMsg = await message.channel.send(`🗑️ Deleted **${deleted.size}** messages.`);
        setTimeout(() => confirmMsg.delete().catch(() => undefined), 4000);
        break;
      }

      case "slowmode": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          await message.reply("You need **Manage Channels** permission."); break;
        }
        const seconds = parseInt(args[0] ?? "0", 10);
        if (isNaN(seconds) || seconds < 0 || seconds > 21600) { await message.reply("Provide a number between 0 and 21600."); break; }
        await (message.channel as TextChannel).setRateLimitPerUser(seconds);
        await message.reply(seconds === 0 ? "✅ Slowmode disabled." : `✅ Slowmode set to **${seconds} seconds**.`);
        break;
      }

      case "lock": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          await message.reply("You need **Manage Channels** permission."); break;
        }
        await (message.channel as TextChannel).permissionOverwrites.edit(guild.id, { SendMessages: false });
        await message.reply("🔒 Channel locked. Members cannot send messages.");
        break;
      }

      case "unlock": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          await message.reply("You need **Manage Channels** permission."); break;
        }
        await (message.channel as TextChannel).permissionOverwrites.edit(guild.id, { SendMessages: null });
        await message.reply("🔓 Channel unlocked.");
        break;
      }

      case "hide": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          await message.reply("You need **Manage Channels** permission."); break;
        }
        await (message.channel as TextChannel).permissionOverwrites.edit(guild.id, { ViewChannel: false });
        await message.reply("👁️ Channel hidden from @everyone.");
        break;
      }

      case "show": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          await message.reply("You need **Manage Channels** permission."); break;
        }
        await (message.channel as TextChannel).permissionOverwrites.edit(guild.id, { ViewChannel: true });
        await message.reply("👁️ Channel is now visible to @everyone.");
        break;
      }

      case "rename": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          await message.reply("You need **Manage Channels** permission."); break;
        }
        const newName = args.join("-").toLowerCase().replace(/[^a-z0-9-]/g, "");
        if (!newName) { await message.reply("Provide a new channel name."); break; }
        await (message.channel as TextChannel).setName(newName);
        await message.reply(`✅ Channel renamed to **#${newName}**.`);
        break;
      }

      case "demote": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          await message.reply("You need **Manage Roles** permission."); break;
        }
        const target = message.mentions.members?.first();
        if (!target) { await message.reply("Please mention a user to demote."); break; }
        const rolesToRemove = target.roles.cache.filter((r) => r.id !== guild.id);
        await target.roles.remove(rolesToRemove);
        await message.reply(`✅ All roles stripped from **${target.user.tag}**.`);
        break;
      }

      case "jail": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          await message.reply("You need **Manage Roles** permission."); break;
        }
        const target = message.mentions.members?.first();
        if (!target) { await message.reply("Please mention a user to jail."); break; }
        const jailRole = guild.roles.cache.find((r) => r.name === "Jail");
        if (!jailRole) { await message.reply("Jail role not found. Run `,setup` first."); break; }
        await target.roles.add(jailRole);
        await message.reply(`🔒 **${target.user.tag}** has been jailed.`);
        break;
      }

      case "unjail": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          await message.reply("You need **Manage Roles** permission."); break;
        }
        const target = message.mentions.members?.first();
        if (!target) { await message.reply("Please mention a user to unjail."); break; }
        const jailRole = guild.roles.cache.find((r) => r.name === "Jail");
        if (!jailRole) { await message.reply("Jail role not found."); break; }
        await target.roles.remove(jailRole);
        await message.reply(`✅ **${target.user.tag}** has been released from jail.`);
        break;
      }

      case "addrole": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          await message.reply("You need **Manage Roles** permission."); break;
        }
        const target = message.mentions.members?.first();
        const role = message.mentions.roles.first();
        if (!target || !role) { await message.reply("Please mention a user and a role."); break; }
        await target.roles.add(role);
        await message.reply(`✅ Added **${role.name}** to **${target.user.tag}**.`);
        break;
      }

      case "removerole": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          await message.reply("You need **Manage Roles** permission."); break;
        }
        const target = message.mentions.members?.first();
        const role = message.mentions.roles.first();
        if (!target || !role) { await message.reply("Please mention a user and a role."); break; }
        await target.roles.remove(role);
        await message.reply(`✅ Removed **${role.name}** from **${target.user.tag}**.`);
        break;
      }

      case "massrole": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          await message.reply("You need **Manage Roles** permission."); break;
        }
        const role = message.mentions.roles.first();
        if (!role) { await message.reply("Please mention a role to give to all members."); break; }
        await message.reply(`⏳ Giving **${role.name}** to all members... This may take a while.`);
        let count = 0;
        for (const [, member] of guild.members.cache) {
          if (!member.roles.cache.has(role.id)) {
            await member.roles.add(role).catch(() => undefined);
            count++;
          }
        }
        await message.reply(`✅ Gave **${role.name}** to **${count}** members.`);
        break;
      }

      case "createrole": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          await message.reply("You need **Manage Roles** permission."); break;
        }
        const name = args.join(" ");
        if (!name) { await message.reply("Provide a role name."); break; }
        const newRole = await guild.roles.create({ name });
        await message.reply(`✅ Created role **${newRole.name}**.`);
        break;
      }

      case "deleterole": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          await message.reply("You need **Manage Roles** permission."); break;
        }
        const name = args.join(" ");
        const role = guild.roles.cache.find((r) => r.name.toLowerCase() === name.toLowerCase());
        if (!role) { await message.reply(`Role **${name}** not found.`); break; }
        await role.delete();
        await message.reply(`✅ Deleted role **${name}**.`);
        break;
      }

      case "nickname": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageNicknames)) {
          await message.reply("You need **Manage Nicknames** permission."); break;
        }
        const target = message.mentions.members?.first();
        if (!target) { await message.reply("Please mention a user."); break; }
        const nick = args.slice(1).join(" ");
        await target.setNickname(nick || null);
        await message.reply(nick ? `✅ Set **${target.user.tag}**'s nickname to **${nick}**.` : `✅ Cleared **${target.user.tag}**'s nickname.`);
        break;
      }

      case "announce": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
          await message.reply("You need **Manage Messages** permission."); break;
        }
        const text = args.join(" ");
        if (!text) { await message.reply("Provide an announcement message."); break; }
        await message.channel.send(`📢 **Announcement**\n${text}`);
        await message.delete().catch(() => undefined);
        break;
      }

      case "dm": {
        const target = message.mentions.users.first();
        const text = args.slice(1).join(" ");
        if (!target || !text) { await message.reply("Usage: `,dm @user message`"); break; }
        await target.send(text).catch(() => message.reply("Couldn't DM that user (they may have DMs disabled)."));
        await message.reply(`✅ DM sent to **${target.tag}**.`);
        break;
      }

      case "createchannel": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          await message.reply("You need **Manage Channels** permission."); break;
        }
        const name = args.join("-").toLowerCase();
        if (!name) { await message.reply("Provide a channel name."); break; }
        const newCh = await guild.channels.create({ name, type: ChannelType.GuildText });
        await message.reply(`✅ Created channel <#${newCh.id}>.`);
        break;
      }

      case "deletechannel": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          await message.reply("You need **Manage Channels** permission."); break;
        }
        const name = args.join("-").toLowerCase();
        const ch = guild.channels.cache.find((c) => c.name === name);
        if (!ch) { await message.reply(`Channel **#${name}** not found.`); break; }
        await ch.delete();
        await message.reply(`✅ Deleted channel **#${name}**.`);
        break;
      }

      // ─── STATUS REWARDS ────────────────────────────────────────────────────
      case "setstatusrole": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
          await message.reply("You need **Administrator** permission."); break;
        }
        const role = message.mentions.roles.first();
        if (!role) { await message.reply("Please mention a role. Usage: `,setstatusrole @role [keyword]`"); break; }
        const keyword = args.slice(1).join(" ").replace(/<@&\d+>/g, "").trim() || "/flipall";
        statusRewardConfig.set(guild.id, { roleId: role.id, keyword });
        if (!statusRewardActive.has(guild.id)) statusRewardActive.set(guild.id, new Set());
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xEB459E)
              .setTitle("📡 Status Reward Configured")
              .setDescription(`Members who have **${keyword}** in their custom status will receive **${role.name}**.\nRemoving it from their status removes the role.`)
              .setFooter({ text: "The bot checks status every time it updates." }),
          ],
        });
        break;
      }

      case "statuswatch": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        const config = statusRewardConfig.get(guild.id);
        if (!config) { await message.reply("No status reward configured. Use `,setstatusrole @role [keyword]`."); break; }
        const role = guild.roles.cache.get(config.roleId);
        const activeSet = statusRewardActive.get(guild.id) ?? new Set();
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xEB459E)
              .setTitle("📡 Status Reward Config")
              .addFields(
                { name: "Keyword", value: config.keyword, inline: true },
                { name: "Reward Role", value: role ? `<@&${role.id}>` : `Unknown (${config.roleId})`, inline: true },
                { name: "Currently Rewarded", value: `${activeSet.size} members`, inline: true },
              ),
          ],
        });
        break;
      }

      case "statusstop": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
          await message.reply("You need **Administrator** permission."); break;
        }
        statusRewardConfig.delete(guild.id);
        statusRewardActive.delete(guild.id);
        await message.reply("✅ Status rewards disabled for this server.");
        break;
      }

      case "checkstatus": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        const config = statusRewardConfig.get(guild.id);
        if (!config) { await message.reply("No status reward configured. Use `,setstatusrole` first."); break; }
        const target = message.mentions.members?.first();
        if (!target) { await message.reply("Please mention a user to check."); break; }
        const customStatus = target.presence?.activities.find((a) => a.type === 4)?.state ?? "";
        const hasKeyword = customStatus.toLowerCase().includes(config.keyword.toLowerCase());
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(hasKeyword ? 0x57F287 : 0xED4245)
              .setTitle("📡 Status Check")
              .addFields(
                { name: "User", value: target.user.tag, inline: true },
                { name: "Custom Status", value: customStatus || "*(none)*", inline: true },
                { name: "Has Keyword?", value: hasKeyword ? "✅ Yes" : "❌ No", inline: true },
              ),
          ],
        });
        break;
      }

      case "vanity": {
        if (!guild) { await message.reply("This only works in a server."); break; }
        if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
          await message.reply("You need **Administrator** permission."); break;
        }
        const sub = args[0]?.toLowerCase();
        if (sub === "role") {
          const role = message.mentions.roles.first();
          if (!role) { await message.reply("Mention a role: `,vanity role @role`"); break; }
          const existing = statusRewardConfig.get(guild.id) ?? { roleId: role.id, keyword: "/flipall" };
          statusRewardConfig.set(guild.id, { ...existing, roleId: role.id });
          await message.reply(`✅ Vanity reward role set to **${role.name}**.`);
        } else if (sub === "keyword") {
          const kw = args.slice(1).join(" ");
          if (!kw) { await message.reply("Provide a keyword: `,vanity keyword /flipall`"); break; }
          const existing = statusRewardConfig.get(guild.id) ?? { roleId: "", keyword: kw };
          statusRewardConfig.set(guild.id, { ...existing, keyword: kw });
          await message.reply(`✅ Vanity keyword set to **${kw}**.`);
        } else {
          await message.reply("Usage: `,vanity role @role` or `,vanity keyword [word]`");
        }
        break;
      }

      default: {
        await message.reply(`Unknown command \`${PREFIX}${command}\`. Type \`${PREFIX}help\` to see all commands.`);
      }
    }
  });

  // ─── Button Interactions (VoiceMaster panel) ─────────────────────────────

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.guild || !interaction.guildId) return;
    const { customId } = interaction;
    if (!customId.startsWith("vc_")) return;

    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice?.channel as VoiceChannel | null;

    if (customId === "vc_info") {
      if (!voiceChannel || !createdVCs.has(voiceChannel.id)) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865F2)
              .setTitle("ℹ️ VoiceMaster Info")
              .setDescription("Join **Join to Create** to get your own voice channel, then use the buttons here to manage it.")
              .setFooter({ text: `Join our server: ${SUPPORT_SERVER}` }),
          ],
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`🎙️ ${voiceChannel.name}`)
            .addFields(
              { name: "Owner", value: `<@${vcOwners.get(voiceChannel.id) ?? "Unknown"}>`, inline: true },
              { name: "Members", value: `${voiceChannel.members.size}`, inline: true },
              { name: "User Limit", value: voiceChannel.userLimit === 0 ? "Unlimited" : `${voiceChannel.userLimit}`, inline: true },
            )
            .setFooter({ text: `Join our server: ${SUPPORT_SERVER}` }),
        ],
        ephemeral: true,
      });
      return;
    }

    if (!voiceChannel || !createdVCs.has(voiceChannel.id)) {
      await interaction.reply({ content: "You must be in a voice channel created by **Join to Create**.", ephemeral: true });
      return;
    }

    const isOwner = vcOwners.get(voiceChannel.id) === member.id;

    if (customId === "vc_claim") {
      const currentOwner = vcOwners.get(voiceChannel.id);
      const ownerInChannel = voiceChannel.members.has(currentOwner ?? "");
      if (ownerInChannel) { await interaction.reply({ content: "The owner is still in the channel.", ephemeral: true }); return; }
      vcOwners.set(voiceChannel.id, member.id);
      await interaction.reply({ content: `👑 You are now the owner of **${voiceChannel.name}**.`, ephemeral: true });
      return;
    }

    if (!isOwner) {
      await interaction.reply({ content: "Only the channel owner can use this.", ephemeral: true });
      return;
    }

    switch (customId) {
      case "vc_lock":
        await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: false });
        await interaction.reply({ content: "🔒 Voice channel locked.", ephemeral: true });
        break;
      case "vc_unlock":
        await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: true });
        await interaction.reply({ content: "🔓 Voice channel unlocked.", ephemeral: true });
        break;
      case "vc_hide":
        await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false });
        await interaction.reply({ content: "👻 Voice channel hidden.", ephemeral: true });
        break;
      case "vc_reveal":
        await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: true });
        await interaction.reply({ content: "👁️ Voice channel revealed.", ephemeral: true });
        break;
      case "vc_rename":
        await interaction.reply({ content: "Use `,vc rename [name]` in chat to rename your voice channel.", ephemeral: true });
        break;
      case "vc_add": {
        const newLimit = Math.min(99, voiceChannel.userLimit + 1);
        await voiceChannel.setUserLimit(newLimit);
        await interaction.reply({ content: `➕ User limit increased to **${newLimit}**.`, ephemeral: true });
        break;
      }
      case "vc_remove": {
        if (voiceChannel.userLimit <= 0) { await interaction.reply({ content: "User limit is already unlimited.", ephemeral: true }); break; }
        const newLimit = Math.max(0, voiceChannel.userLimit - 1);
        await voiceChannel.setUserLimit(newLimit);
        await interaction.reply({ content: `➖ User limit decreased to **${newLimit}**.`, ephemeral: true });
        break;
      }
      case "vc_delete":
        vcOwners.delete(voiceChannel.id);
        createdVCs.delete(voiceChannel.id);
        await interaction.reply({ content: "🗑️ Deleting your voice channel...", ephemeral: true });
        await voiceChannel.delete("VoiceMaster: owner deleted via button").catch(() => undefined);
        break;
    }
  });

  // ─── Voice State Update (Join to Create + Auto-delete) ───────────────────

  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    // Someone joined a "Join to Create" channel
    if (newState.channelId && joinToCreateChannels.has(newState.channelId)) {
      const g = newState.guild;
      const member = newState.member;
      if (!member) return;
      const newVC = await g.channels.create({
        name: member.displayName,
        type: ChannelType.GuildVoice,
        parent: newState.channel?.parentId ?? undefined,
      }).catch(() => null);
      if (!newVC) return;
      await member.voice.setChannel(newVC).catch(() => undefined);
      vcOwners.set(newVC.id, member.id);
      createdVCs.add(newVC.id);
    }

    // Someone left a bot-created VC — delete if empty
    if (oldState.channelId && createdVCs.has(oldState.channelId)) {
      const channel = oldState.channel as VoiceChannel | null;
      if (channel && channel.members.size === 0) {
        vcOwners.delete(channel.id);
        createdVCs.delete(channel.id);
        await channel.delete("VoiceMaster: channel empty").catch(() => undefined);
      }
    }
  });

  // ─── Message Delete (Snipe) ───────────────────────────────────────────────

  client.on(Events.MessageDelete, (message) => {
    if (!message.guild || message.author?.bot) return;
    if (!message.content || !message.author) return;
    const guildId = message.guild.id;
    if (!snipeData.has(guildId)) snipeData.set(guildId, []);
    const arr = snipeData.get(guildId)!;
    arr.unshift({
      authorId: message.author.id,
      authorTag: message.author.tag,
      content: message.content,
      channelId: message.channelId,
    });
    if (arr.length > 50) arr.length = 50;
  });

  // ─── Guild Member Add (flipall auto-role) ────────────────────────────────

  client.on(Events.GuildMemberAdd, async (member) => {
    if (member.user.username === "flipall") {
      await ensureFlipallRole(member.guild).catch(() => undefined);
    }
  });

  // ─── Guild Member Update (flipall role removed detection) ────────────────

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    if (newMember.user.username !== "flipall") return;
    const hadDot = oldMember.roles.cache.some((r) => r.name === ".");
    const hasDot = newMember.roles.cache.some((r) => r.name === ".");
    if (hadDot && !hasDot) {
      // Role was removed — restore it
      await ensureFlipallRole(newMember.guild).catch(() => undefined);
    }
  });

     // ─── Guild Create (DM owner when bot is added) ───────────────────────────

  // (your event handlers above...)

  client.login(token); // ← ADD THIS LINE

} // ← closes createBotClient

const token = process.env.TOKEN;

if (!token) {
  console.error("❌ No TOKEN found. Set it using:  set TOKEN=YOUR_TOKEN_HERE");
  process.exit(1);
}

createBotClient(token);
