import {
  Client,
  Events,
  GatewayIntentBits,
  type Message,
} from "discord.js";

const token = process.env.DISCORD_BOT_TOKEN;
const prefix = process.env.DISCORD_BOT_PREFIX ?? "!";

if (!token) {
  console.error(
    "Missing DISCORD_BOT_TOKEN. Add your Discord bot token as a private secret named DISCORD_BOT_TOKEN.",
  );
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Discord bot is online as ${readyClient.user.tag}`);
  console.log(`Command prefix: ${prefix}`);
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