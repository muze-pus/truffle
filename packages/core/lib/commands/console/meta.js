module.exports = {
  command: "console",
  description:
    "Run a console with contract abstractions and commands available",
  builder: {},
  help: {
    usage: "truffle console [--verbose-rpc] [--require|-r <file>]",
    options: [
      {
        option: "--verbose-rpc",
        description:
          "Log communication between Truffle and the Ethereum client."
      },
      {
        option: "--require|-r <file>",
        description:
          "Preload console environment from required JavaScript " +
          "file. The default export must be an object with named keys that " +
          "will be used\n                    to populate the console environment."
      },
      {
        option: "--require-none",
        description:
          "Do not load any user-defined JavaScript into the " +
          "console environment. This option takes precedence over --require, " +
          "-r, and\n                    values provided for console.require " +
          "in your project's truffle-config.js."
      }
    ],
    allowedGlobalOptions: ["network", "config"]
  }
};
