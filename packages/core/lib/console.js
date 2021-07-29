const repl = require("repl");
const Command = require("./command");
const provision = require("@truffle/provisioner");
const {
  Web3Shim,
  createInterfaceAdapter
} = require("@truffle/interface-adapter");
const contract = require("@truffle/contract");
const vm = require("vm");
const expect = require("@truffle/expect");
const TruffleError = require("@truffle/error");
const fse = require("fs-extra");
const path = require("path");
const EventEmitter = require("events");
const spawnSync = require("child_process").spawnSync;
const Require = require("@truffle/require");

const processInput = input => {
  const inputComponents = input.trim().split(" ");
  if (inputComponents.length === 0) return input;

  if (inputComponents[0] === "truffle") {
    return inputComponents.slice(1).join(" ");
  }
  return input.trim();
};

class Console extends EventEmitter {
  constructor(tasks, options) {
    super();
    EventEmitter.call(this);

    expect.options(options, [
      "working_directory",
      "contracts_directory",
      "contracts_build_directory",
      "migrations_directory",
      "networks",
      "network",
      "network_id",
      "provider",
      "resolver",
      "build_directory"
    ]);

    this.options = options;

    this.command = new Command(tasks);

    this.repl = null;

    this.interfaceAdapter = createInterfaceAdapter({
      provider: options.provider,
      networkType: options.networks[options.network].type
    });
    this.web3 = new Web3Shim({
      provider: options.provider,
      networkType: options.networks[options.network].type
    });
  }

  async start() {
    try {
      this.repl = repl.start({
        prompt: "truffle(" + this.options.network + ")> ",
        eval: this.interpret.bind(this)
      });

      await this.setUpEnvironment();
      this.provision();

      //want repl to exit when it receives an exit command
      this.repl.on("exit", () => {
        process.exit();
      });

      // ensure that `await`-ing this method never resolves. (we want to keep
      // the console open until it exits on its own)
      return new Promise(() => {});
    } catch (error) {
      this.options.logger.log(
        "Unexpected error setting up the environment or provisioning " +
        "contracts while instantiating the console."
      );
      this.options.logger.log(error.stack || error.message || error);
    }
  }

  hydrateUserDefinedVariables({
    accounts,
    interfaceAdapter,
    web3,
  }) {
    // exit if feature should be disabled
    if (this.options["require-none"]) return;

    // exit if no hydrate options are set
    if (
      (!this.options.console || !this.options.console.require) &&
      !this.options.require &&
      !this.options.r
    ) return;

    const addToContext = (userData, namespace) => {
      for (const key in userData) {
        if (namespace) {
          if (typeof this.repl.context[namespace] === "undefined") {
            this.repl.context[namespace] = {};
          }
          this.repl.context[namespace][key] = userData[key];
        } else {
          this.repl.context[key] = userData[key];
        }
      }
    };
    const errorMessage = "You must specify the console.require property as " +
      "either a string or an array. If you specify an array, its members " +
      "must be paths or objects containing at least a `path` property.";

    const requireValue = this.options.r || this.options.require || this.options.console.require;

    // Require allows us to inject Truffle variables into the script's scope
    const requireOptions = {
      context: {
        accounts,
        interfaceAdapter,
        web3,
      }
    };
    if (typeof requireValue === "string") {
      requireOptions.file = requireValue;
      addToContext(Require.file(requireOptions));
    } else if (Array.isArray(requireValue)) {
      this.options.console.require.forEach(item => {
        if (typeof item === "string") {
          requireOptions.file = item;
          addToContext(Require.file(requireOptions));
        } else if (typeof item === "object" && item.path) {
          requireOptions.file = item.path;
          addToContext(Require.file(requireOptions), item.as);
        } else {
          throw new Error(errorMessage);
        }
      });
    } else {
      throw new Error(errorMessage);
    }
  }

  async setUpEnvironment() {
    let accounts;
    try {
      accounts = await this.interfaceAdapter.getAccounts();
    } catch {
      // don't prevent Truffle from working if user doesn't provide some way
      // to sign transactions (e.g. no reason to disallow debugging)
      accounts = [];
    }
    // we load user variables first so as to not clobber ours
    this.hydrateUserDefinedVariables({
      web3: this.web3,
      interfaceAdapter: this.interfaceAdapter,
      accounts
    });

    this.repl.context.web3 = this.web3;
    this.repl.context.interfaceAdapter = this.interfaceAdapter;
    this.repl.context.accounts = accounts;
  }

  provision() {
    let files;
    try {
      const unfilteredFiles = fse.readdirSync(
        this.options.contracts_build_directory
      );
      files = unfilteredFiles.filter(file => file.endsWith(".json"));
    } catch (error) {
      // Error reading the build directory? Must mean it doesn't exist or we don't have access to it.
      // Couldn't provision the contracts if we wanted. It's possible we're hiding very rare FS
      // errors, but that's better than showing the user error messages that will be "build folder
      // doesn't exist" 99.9% of the time.
    }

    let jsonBlobs = [];
    files = files || [];

    files.forEach(file => {
      try {
        const body = fse.readFileSync(
          path.join(this.options.contracts_build_directory, file),
          "utf8"
        );
        jsonBlobs.push(JSON.parse(body));
      } catch (error) {
        throw new Error(`Error parsing or reading ${file}: ${error.message}`);
      }
    });

    const abstractions = jsonBlobs.map(json => {
      const abstraction = contract(json);
      provision(abstraction, this.options);
      return abstraction;
    });

    this.resetContractsInConsoleContext(abstractions);
    return abstractions;
  }

  resetContractsInConsoleContext(abstractions) {
    abstractions = abstractions || [];

    const contextVars = {};

    abstractions.forEach(abstraction => {
      contextVars[abstraction.contract_name] = abstraction;
    });

    // make sure the repl gets the new contracts in its context
    Object.keys(contextVars || {}).forEach(key => {
      this.repl.context[key] = contextVars[key];
    });
  }

  runSpawn(inputStrings, options) {
    let childPath;
    if (typeof BUNDLE_CONSOLE_CHILD_FILENAME !== "undefined") {
      childPath = path.join(__dirname, BUNDLE_CONSOLE_CHILD_FILENAME);
    } else {
      childPath = path.join(__dirname, "../lib/console-child.js");
    }

    // stderr is piped here because we don't need to repeatedly see the parent
    // errors/warnings in child process - specifically the error re: having
    // multiple config files
    const spawnOptions = { stdio: ["inherit", "inherit", "pipe"] };
    const settings = ["config", "network"]
      .filter(setting => options[setting])
      .map(setting => `--${setting} ${options[setting]}`)
      .join(" ");

    const spawnInput = `${settings} -- ${inputStrings}`;

    const spawnResult = spawnSync(
      "node",
      ["--no-deprecation", childPath, spawnInput],
      spawnOptions
    );

    if (spawnResult.stderr) {
      // Theoretically stderr can contain multiple errors.
      // So let's just print it instead of throwing through
      // the error handling mechanism. Bad call?
      console.log(spawnResult.stderr.toString());
    }

    // re-provision to ensure any changes are available in the repl
    this.provision();

    //display prompt when child repl process is finished
    this.repl.displayPrompt();
  }

  interpret(input, context, filename, callback) {
    const processedInput = processInput(input);
    if (
      this.command.getCommand(processedInput, this.options.noAliases) != null
    ) {
      try {
        this.runSpawn(processedInput, this.options);
      } catch (error) {
        // Perform error handling ourselves.
        if (error instanceof TruffleError) {
          console.log(error.message);
        } else {
          // Bubble up all other unexpected errors.
          console.log(error.stack || error.toString());
        }
        return callback();
      }

      // Reprovision after each command as it may change contracts.
      try {
        this.provision();
        return callback();
      } catch (error) {
        // Don't pass abstractions to the callback if they're there or else
        // they'll get printed in the repl.
        return callback(error);
      }
    }

    // Much of the following code is from here, though spruced up:
    // https://github.com/nfcampos/await-outside

    /*
    - allow whitespace before everything else
    - optionally capture `var|let|const <varname> = `
      - varname only matches if it starts with a-Z or _ or $
        and if contains only those chars or numbers
      - this is overly restrictive but is easier to maintain
    - capture `await <anything that follows it>`
    */
    let includesAwait = /^\s*((?:(?:var|const|let)\s+)?[a-zA-Z_$][0-9a-zA-Z_$]*\s*=\s*)?(\(?\s*await[\s\S]*)/;

    const match = processedInput.match(includesAwait);
    let source = processedInput;
    let assignment = null;

    // If our code includes an await, add special processing to ensure it's evaluated properly.
    if (match) {
      let assign = match[1];

      const expression =
        match[2] && match[2].endsWith(";")
          ? // strip off trailing ";" to prevent the expression below from erroring
            match[2].slice(0, -1)
          : match[2];

      const RESULT = "__await_outside_result";

      // Wrap the await inside an async function.
      // Strange indentation keeps column offset correct in stack traces
      source = `(async function() { try { ${
        assign ? `global.${RESULT} =` : "return"
      } (
  ${expression.trim()}
  ); } catch(e) { global.ERROR = e; throw e; } }())`;

      assignment = assign
        ? `${assign.trim()} global.${RESULT}; void delete global.${RESULT};`
        : null;
    }

    const runScript = script => {
      const options = {
        displayErrors: true,
        breakOnSigint: true,
        filename: filename
      };

      vm.createContext(context);
      return script.runInContext(context, options);
    };

    let script;
    try {
      const options = { displayErrors: true, lineOffset: -1 };
      script = vm.createScript(source, options);
    } catch (error) {
      // If syntax error, or similar, bail.
      return callback(error);
    }

    // Ensure our script returns a promise whether we're using an
    // async function or not. If our script is an async function,
    // this will ensure the console waits until that await is finished.
    Promise.resolve(runScript(script))
      .then(value => {
        // If there's an assignment to run, run that.
        if (assignment) return runScript(vm.createScript(assignment));
        return value;
      })
      .then(value => {
        // All good? Return the value (e.g., eval'd script or assignment)
        callback(null, value);
      })
      .catch(callback);
  }
}

module.exports = Console;
