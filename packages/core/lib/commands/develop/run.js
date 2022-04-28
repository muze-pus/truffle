const emoji = require("node-emoji");
const mnemonicInfo = require("../../mnemonics/mnemonic");
const { configureManagedGanache } = require("../../configureGanacheOptions");

const runConsole = async (config, ganacheOptions) => {
  const Console = require("../../console");
  const { Environment } = require("@truffle/environment");

  const commands = require("../index");
  const excluded = new Set(["console", "develop", "unbox", "init"]);

  const consoleCommands = Object.keys(commands).reduce((acc, name) => {
    return !excluded.has(name)
      ? Object.assign(acc, { [name]: commands[name] })
      : acc;
  }, {});

  await Environment.develop(config, ganacheOptions);
  const c = new Console(consoleCommands, config.with({ noAliases: true }));
  c.on("exit", () => process.exit());
  return await c.start();
};

module.exports = async options => {
  const { Develop } = require("@truffle/environment");
  const Config = require("@truffle/config");

  const config = Config.detect(options);
  const customConfig = config.networks.develop || {};

  const getAccounts = customConfig => {
    if ("accounts" in customConfig) {
      return mnemonicInfo.getAccountsInfo(customConfig.accounts);
    }
    if ("total_accounts" in customConfig) {
      return mnemonicInfo.getAccountsInfo(customConfig.total_accounts);
    }
    return mnemonicInfo.getAccountsInfo(10);
  };

  const { mnemonic, accounts, privateKeys } = getAccounts(customConfig);

  const onMissing = () => "**";

  const warning =
    ":warning:  Important :warning:  : " +
    "This mnemonic was created for you by Truffle. It is not secure.\n" +
    "Ensure you do not use it on production blockchains, or else you risk losing funds.";

  const ipcOptions = { log: options.log };
  const ganacheOptions = configureManagedGanache(
    config,
    customConfig,
    mnemonic
  );

  const { started } = await Develop.connectOrStart(ipcOptions, ganacheOptions);
  const url = `http://${ganacheOptions.host}:${ganacheOptions.port}/`;

  if (started) {
    config.logger.log(`Truffle Develop started at ${url}`);
    config.logger.log();

    config.logger.log(`Accounts:`);
    accounts.forEach((acct, idx) => config.logger.log(`(${idx}) ${acct}`));
    config.logger.log();

    config.logger.log(`Private Keys:`);
    privateKeys.forEach((key, idx) => config.logger.log(`(${idx}) ${key}`));
    config.logger.log();

    config.logger.log(`Mnemonic: ${mnemonic}`);
    config.logger.log();
    config.logger.log(emoji.emojify(warning, onMissing));
    config.logger.log();
  } else {
    config.logger.log(
      `Connected to existing Truffle Develop session at ${url}`
    );
    config.logger.log();
  }

  if (options.log) {
    // leave the process open so that logging can take place
    return new Promise(() => {});
  }
  return await runConsole(config, ganacheOptions);
};
