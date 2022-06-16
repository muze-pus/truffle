module.exports = async function (options) {
  const { Console, excludedCommands } = require("../../console");
  const { Environment } = require("@truffle/environment");
  const commands = require("../commands");
  const loadConfig = require("../../loadConfig");

  if (options.url && options.network) {
    throw new Error("'url' and 'network' are mutually exclusive options");
  }

  let config = loadConfig(options);

  const consoleCommands = commands.reduce((acc, name) => {
    return !excludedCommands.has(name)
      ? Object.assign(acc, { [name]: commands[name] })
      : acc;
  }, {});

  await Environment.detect(config);
  const c = new Console(consoleCommands, config.with({ noAliases: true }));
  return await c.start();
};
