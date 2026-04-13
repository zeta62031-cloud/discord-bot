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

const token = process.env.TOKEN ?? process.env.DISCORD_BOT_TOKEN;
const prefix = process.env.DISCORD_BOT_PREFIX ?? ",";

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

  if (
    !me
    || !me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)
  ) {
    console.warn(
      `Cannot DM inviter for ${guild.name}: missing View Audit Log permission`,
    );
    return;
  }

  try {
    const auditLogs = await guild.fetchAuditLogs({
      type: AuditLogEvent.BotAdd,
      limit: 5,
    });

    const botAddLog = auditLogs.entries.find((entry) => {
      return entry.target?.id === client.user?.id;
    });

    const inviter = botAddLog?.executor;

    if (!inviter) {
      console.warn(`Cannot DM inviter for ${guild.name}: inviter not found`);
      return;
    }

    await inviter.send(
      "tysm for adding the bot to your server the prefix is , and join our support server https://discord.gg/clubiris",
    );
  } catch (error) {
    console.warn(`Could not DM inviter for ${guild.name}`, error);
  }
});

client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
  const welcomeMessage = `welcome ${member} have a nice time and rep /clubiris in your status for pic perms`;
  const me = member.guild.members.me;

  const channel =
    member.guild.systemChannel ??
    member.guild.channels.cache.find((guildChannel) => {
      if (guildChannel.type !== ChannelType.GuildText || !me) {
        return false;
      }

      return guildChannel
        .permissionsFor(me)
        ?.has([
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
        ]);
    });

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
    await message.reply("Pong!");
    return;
  }

  if (command === "help") {
    await message.reply(
      [
        `Commands use the \`${prefix}\` prefix.`,
        `\`${prefix}ping\` checks if the bot is online.`,
        `\`${prefix}say your message\` makes the bot repeat your message.`,
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

  await message.reply(
    `I don't know that command yet. Try \`${prefix}help\`.`,
  );
});

client.login(token);