import {
  AuditLogEvent,
  ChannelType,
  Client,
  Events,
  type Guild,
  GatewayIntentBits,
  PermissionsBitField,
  type GuildMember,
  type Message,
} from "discord.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const token = process.env.TOKEN ?? process.env.DISCORD_BOT_TOKEN;
const prefix = process.env.DISCORD_BOT_PREFIX ?? ",";
const defaultWelcomeMessage =
  "welcome {user} have a nice time and rep /clubiris in your status for pic perms";
const configPath = fileURLToPath(new URL("../data/guild-config.json", import.meta.url));

type GuildWelcomeConfig = {
  channelId?: string;
  enabled: boolean;
  message: string;
};

type GuildConfig = {
  welcome: GuildWelcomeConfig;
};

type GuildConfigs = Record<string, GuildConfig>;

function loadConfigs(): GuildConfigs {
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as GuildConfigs;
  } catch {
    return {};
  }
}

let guildConfigs = loadConfigs();

function saveConfigs() {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(guildConfigs, null, 2));
}

function getGuildConfig(guildId: string): GuildConfig {
  guildConfigs[guildId] ??= {
    welcome: {
      enabled: true,
      message: defaultWelcomeMessage,
    },
  };

  return guildConfigs[guildId];
}

function renderWelcomeMessage(template: string, member: GuildMember) {
  return template
    .replaceAll("{user}", `${member}`)
    .replaceAll("{username}", member.user.username)
    .replaceAll("{server}", member.guild.name)
    .replaceAll("{membercount}", `${member.guild.memberCount}`);
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  return `${days}d ${hours}h ${minutes}m ${remainingSeconds}s`;
}

function hasManageServer(message: Message) {
  return Boolean(
    message.member?.permissions.has(PermissionsBitField.Flags.ManageGuild),
  );
}

function getMentionedOrAuthor(message: Message) {
  return message.mentions.users.first() ?? message.author;
}

function findSendableTextChannel(guild: Guild, preferredChannelId?: string) {
  const me = guild.members.me;
  const preferredChannel = preferredChannelId
    ? guild.channels.cache.get(preferredChannelId)
    : undefined;
  const channels = [
    preferredChannel,
    guild.systemChannel,
    ...guild.channels.cache.values(),
  ];

  return channels.find((guildChannel) => {
    if (!guildChannel || guildChannel.type !== ChannelType.GuildText || !me) {
      return false;
    }

    return guildChannel
      .permissionsFor(me)
      ?.has([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
      ]);
  });
}

if (!token) {
  console.error(
    "Missing TOKEN. Add your Discord bot token as a private secret named TOKEN.",
  );
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Discord bot is online as ${readyClient.user.tag}`);
  console.log(`Command prefix: ${prefix}`);
});

client.on(Events.GuildCreate, async (guild: Guild) => {
  const me = guild.members.me;
  let inviter;

  if (!me || !me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) {
    console.warn(
      `Cannot find inviter for ${guild.name}: missing View Audit Log permission`,
    );
  } else {
    try {
      const auditLogs = await guild.fetchAuditLogs({
        type: AuditLogEvent.BotAdd,
        limit: 5,
      });

      const botAddLog = auditLogs.entries.find((entry) => {
        return entry.target?.id === client.user?.id;
      });

      inviter = botAddLog?.executor;

      if (!inviter) {
        console.warn(`Cannot find inviter for ${guild.name}: inviter not found`);
      }
    } catch (error) {
      console.warn(`Could not find inviter for ${guild.name}`, error);
    }
  }

  if (inviter) {
    await inviter.send(
      [
        "💜 **Thank you for adding the bot to your server!**",
        "",
        "🛡️ This bot is built to help keep your server **secure, safe, and protected**.",
        "⚔️ Features include anti-nuke, anti-raid, bump tools, and server protection commands.",
        "✨ Use it to help protect your community and keep things running smoothly.",
        "❓ If you need help, type `,help` in chat for a full list of commands.",
        "",
        "📌 **Prefix:** `,`",
        "🔗 **Support Server:** https://discord.gg/clubiris",
      ].join("\n"),
    ).catch((error) => {
      console.warn(`Could not DM inviter for ${guild.name}`, error);
    });
  }

  const channel = findSendableTextChannel(guild);

  if (!channel || channel.type !== ChannelType.GuildText) {
    console.warn(`No server intro channel found in ${guild.name}`);
    return;
  }

  await channel.send(
    [
      `${inviter ? `<@${inviter.id}> ` : ""}💜 **Thanks for adding me to ${guild.name}!**`,
      "",
      "❓ If you need help, type `,help` in chat for a full list of commands.",
      "📌 **Prefix:** `,`",
      "🔗 **Support Server:** https://discord.gg/clubiris",
    ].join("\n"),
  );
});

client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
  const guildConfig = getGuildConfig(member.guild.id);

  if (!guildConfig.welcome.enabled) {
    return;
  }

  const welcomeMessage = renderWelcomeMessage(
    guildConfig.welcome.message,
    member,
  );
  const me = member.guild.members.me;
  const channel = findSendableTextChannel(
    member.guild,
    guildConfig.welcome.channelId,
  );

  if (!channel || channel.type !== ChannelType.GuildText) {
    console.warn(`No welcome channel found in ${member.guild.name}`);
    return;
  }

  await channel.send(welcomeMessage);
});

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot || !message.content.startsWith(prefix)) {
    return;
  }

  const [commandName, ...args] = message.content
    .slice(prefix.length)
    .trim()
    .split(/\s+/);

  const command = commandName?.toLowerCase();

  if (!command) {
    return;
  }

  if (command === "ping") {
    await message.reply(`🏓 Pong! Latency: ${client.ws.ping}ms`);
    return;
  }

  if (command === "help") {
    await message.reply(
      [
        "💜 **Club Iris Bot Commands**",
        `Prefix: \`${prefix}\``,
        "",
        "🧰 **General**",
        `\`${prefix}help\` — show this command list`,
        `\`${prefix}ping\` — check if the bot is online`,
        `\`${prefix}say <message>\` — make the bot repeat a message`,
        `\`${prefix}avatar [@user]\` — show someone's avatar`,
        `\`${prefix}userinfo [@user]\` — show basic user info`,
        `\`${prefix}serverinfo\` — show server info`,
        `\`${prefix}botinfo\` — show bot info`,
        `\`${prefix}membercount\` — show member count`,
        `\`${prefix}uptime\` — show bot uptime`,
        `\`${prefix}invite\` — get bot invite info`,
        `\`${prefix}support\` — get support server link`,
        "",
        "🎲 **Fun**",
        `\`${prefix}coinflip\` — flip a coin`,
        `\`${prefix}roll [sides]\` — roll a dice`,
        `\`${prefix}choose option 1 | option 2\` — let the bot choose`,
        "",
        "🛠️ **Admin**",
        `\`${prefix}clear <amount>\` — delete messages`,
        `\`${prefix}setwelcome #channel <message>\` — set welcome channel and message`,
        `\`${prefix}welcome view\` — show welcome settings`,
        `\`${prefix}welcome channel #channel\` — set welcome channel`,
        `\`${prefix}welcome message <message>\` — set welcome message`,
        `\`${prefix}welcome test\` — test the welcome message`,
        `\`${prefix}welcome on\` / \`${prefix}welcome off\` — enable or disable welcomes`,
        "",
        "Welcome placeholders: `{user}`, `{username}`, `{server}`, `{membercount}`",
      ].join("\n"),
    );
    return;
  }

  if (command === "say") {
    const text = args.join(" ").trim();

    if (!text) {
      await message.reply(`Use it like this: \`${prefix}say hello everyone\``);
      return;
    }

    await message.channel.send(text);
    return;
  }

  if (command === "avatar") {
    const user = getMentionedOrAuthor(message);
    await message.reply(
      `🖼️ **${user.username}'s avatar:** ${user.displayAvatarURL({ size: 1024 })}`,
    );
    return;
  }

  if (command === "userinfo") {
    const user = getMentionedOrAuthor(message);
    const member = message.guild?.members.cache.get(user.id);

    await message.reply(
      [
        `👤 **User Info: ${user.username}**`,
        `ID: \`${user.id}\``,
        `Bot: ${user.bot ? "Yes" : "No"}`,
        `Account created: <t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
        member?.joinedTimestamp
          ? `Joined server: <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
          : "Joined server: unknown",
      ].join("\n"),
    );
    return;
  }

  if (command === "serverinfo") {
    if (!message.guild) {
      await message.reply("This command only works in a server.");
      return;
    }

    await message.reply(
      [
        `🏠 **Server Info: ${message.guild.name}**`,
        `ID: \`${message.guild.id}\``,
        `Owner: <@${message.guild.ownerId}>`,
        `Members: ${message.guild.memberCount}`,
        `Channels: ${message.guild.channels.cache.size}`,
        `Created: <t:${Math.floor(message.guild.createdTimestamp / 1000)}:R>`,
      ].join("\n"),
    );
    return;
  }

  if (command === "botinfo") {
    await message.reply(
      [
        "🤖 **Bot Info**",
        `Name: ${client.user?.tag ?? "Unknown"}`,
        `Servers: ${client.guilds.cache.size}`,
        `Prefix: \`${prefix}\``,
        `Uptime: ${formatDuration(client.uptime ?? 0)}`,
        "Focus: anti-raid, anti-nuke, bump tools, welcome messages, and server utility.",
      ].join("\n"),
    );
    return;
  }

  if (command === "membercount") {
    if (!message.guild) {
      await message.reply("This command only works in a server.");
      return;
    }

    await message.reply(`👥 This server has **${message.guild.memberCount}** members.`);
    return;
  }

  if (command === "uptime") {
    await message.reply(`⏱️ Uptime: **${formatDuration(client.uptime ?? 0)}**`);
    return;
  }

  if (command === "support") {
    await message.reply("🔗 Support server: https://discord.gg/clubiris");
    return;
  }

  if (command === "invite") {
    await message.reply(
      "💜 Invite/support link: https://discord.gg/clubiris\nMake sure the bot has permissions to view/send messages, manage messages for clear, view audit log for inviter DMs, and server members intent for welcomes.",
    );
    return;
  }

  if (command === "coinflip") {
    await message.reply(Math.random() > 0.5 ? "🪙 Heads!" : "🪙 Tails!");
    return;
  }

  if (command === "roll") {
    const sides = Math.min(Math.max(Number(args[0]) || 6, 2), 100000);
    const result = Math.floor(Math.random() * sides) + 1;
    await message.reply(`🎲 You rolled **${result}** out of ${sides}.`);
    return;
  }

  if (command === "choose") {
    const options = args.join(" ").split("|").map((option) => option.trim()).filter(Boolean);

    if (options.length < 2) {
      await message.reply(`Use it like this: \`${prefix}choose pizza | burgers | tacos\``);
      return;
    }

    const choice = options[Math.floor(Math.random() * options.length)];
    await message.reply(`✨ I choose: **${choice}**`);
    return;
  }

  if (command === "clear") {
    if (!message.guild || message.channel.type !== ChannelType.GuildText) {
      await message.reply("This command only works in a server text channel.");
      return;
    }

    if (!message.member?.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      await message.reply("You need **Manage Messages** to use this.");
      return;
    }

    const amount = Math.min(Math.max(Number(args[0]) || 0, 1), 100);

    if (!amount) {
      await message.reply(`Use it like this: \`${prefix}clear 10\``);
      return;
    }

    const deleted = await message.channel.bulkDelete(amount, true);
    await message.channel.send(`🧹 Deleted **${deleted.size}** messages.`).then((sent) => {
      setTimeout(() => {
        sent.delete().catch(() => undefined);
      }, 3000);
    });
    return;
  }

  if (command === "setwelcome") {
    if (!message.guild) {
      await message.reply("This command only works in a server.");
      return;
    }

    if (!hasManageServer(message)) {
      await message.reply("You need **Manage Server** to change welcome settings.");
      return;
    }

    const channel = message.mentions.channels.first();

    if (!channel || channel.type !== ChannelType.GuildText) {
      await message.reply(`Use it like this: \`${prefix}setwelcome #channel welcome {user} to {server}\``);
      return;
    }

    const customMessage = args.slice(1).join(" ").trim() || defaultWelcomeMessage;
    const guildConfig = getGuildConfig(message.guild.id);
    guildConfig.welcome.enabled = true;
    guildConfig.welcome.channelId = channel.id;
    guildConfig.welcome.message = customMessage;
    saveConfigs();

    await message.reply(
      [
        "✅ Welcome settings saved.",
        `Channel: ${channel}`,
        `Message: ${customMessage}`,
      ].join("\n"),
    );
    return;
  }

  if (command === "welcome") {
    if (!message.guild) {
      await message.reply("This command only works in a server.");
      return;
    }

    if (!hasManageServer(message)) {
      await message.reply("You need **Manage Server** to change welcome settings.");
      return;
    }

    const action = args[0]?.toLowerCase();
    const guildConfig = getGuildConfig(message.guild.id);

    if (action === "view" || !action) {
      await message.reply(
        [
          "👋 **Welcome Settings**",
          `Enabled: ${guildConfig.welcome.enabled ? "Yes" : "No"}`,
          `Channel: ${guildConfig.welcome.channelId ? `<#${guildConfig.welcome.channelId}>` : "auto/system channel"}`,
          `Message: ${guildConfig.welcome.message}`,
        ].join("\n"),
      );
      return;
    }

    if (action === "on") {
      guildConfig.welcome.enabled = true;
      saveConfigs();
      await message.reply("✅ Welcome messages are now on.");
      return;
    }

    if (action === "off") {
      guildConfig.welcome.enabled = false;
      saveConfigs();
      await message.reply("✅ Welcome messages are now off.");
      return;
    }

    if (action === "channel") {
      const channel = message.mentions.channels.first();

      if (!channel || channel.type !== ChannelType.GuildText) {
        await message.reply(`Use it like this: \`${prefix}welcome channel #channel\``);
        return;
      }

      guildConfig.welcome.channelId = channel.id;
      guildConfig.welcome.enabled = true;
      saveConfigs();
      await message.reply(`✅ Welcome channel set to ${channel}.`);
      return;
    }

    if (action === "message") {
      const customMessage = args.slice(1).join(" ").trim();

      if (!customMessage) {
        await message.reply(
          `Use it like this: \`${prefix}welcome message welcome {user} to {server}\``,
        );
        return;
      }

      guildConfig.welcome.message = customMessage;
      guildConfig.welcome.enabled = true;
      saveConfigs();
      await message.reply(`✅ Welcome message set to:\n${customMessage}`);
      return;
    }

    if (action === "test") {
      const testMessage = renderWelcomeMessage(guildConfig.welcome.message, message.member as GuildMember);
      await message.channel.send(testMessage);
      return;
    }

    await message.reply(
      `Unknown welcome option. Try \`${prefix}welcome view\`, \`${prefix}welcome channel #channel\`, \`${prefix}welcome message <message>\`, \`${prefix}welcome test\`, \`${prefix}welcome on\`, or \`${prefix}welcome off\`.`,
    );
    return;
  }

  await message.reply(
    `I don't know that command yet. Try \`${prefix}help\`.`,
  );
});

client.login(token);