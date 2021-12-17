const OS = require("os");

module.exports = {
  command: "debug",
  description: "Interactively debug any transaction on the blockchain",
  builder: {
    "_": {
      type: "string"
    },
    "fetch-external": {
      describe: "Allow debugging of external contracts",
      alias: "x",
      type: "boolean",
      default: false
    },
    "compile-tests": {
      describe: "Allow debugging of Solidity test contracts",
      type: "boolean",
      default: false
    },
    "compile-all": {
      describe: "Force debugger to compile all contracts for extra safety",
      type: "boolean",
      default: false
    },
    "compile-none": {
      describe: "Force debugger to skip compilation (dangerous!)",
      type: "boolean",
      default: false
    },
    "url": {
      describe: "Use specified URL for provider",
      type: "string"
    }
  },
  help: {
    usage:
      "truffle debug [<transaction_hash>] [--fetch-external|-x]" +
      OS.EOL +
      "                             [--compile-tests|--compile-all|--compile-none]",
    options: [
      {
        option: "<transaction_hash>",
        description:
          "Transaction ID to use for debugging.  Mandatory if --fetch-external is passed."
      },
      {
        option: "--fetch-external|-x",
        description:
          "Allows debugging of external contracts with verified sources."
      },
      {
        option: "--compile-tests",
        description:
          "Allows debugging of Solidity test contracts from the test directory.  Implies --compile-all."
      },
      {
        option: "--compile-all",
        description:
          "Forces the debugger to recompile all contracts even if it detects that it can use the artifacts."
      },
      {
        option: "--compile-none",
        description:
          "Forces the debugger to use artifacts even if it detects a problem.  Dangerous; may cause errors."
      },
      {
        option: "--url",
        description: "Connects to a specified provider given via URL, ignoring networks in config"
      },
    ],
    allowedGlobalOptions: ["network", "config"]
  }
};
