var debug = require("debug")("workflow-compile");
var mkdirp = require("mkdirp");
var { callbackify, promisify } = require("util");
var Config = require("truffle-config");
var solcCompile = require("truffle-compile");
var vyperCompile = require("truffle-compile-vyper");
var externalCompile = require("truffle-external-compile");
var expect = require("truffle-expect");
var Resolver = require("truffle-resolver");
var Artifactor = require("truffle-artifactor");
var OS = require("os");

const SUPPORTED_COMPILERS = {
  solc: solcCompile,
  vyper: vyperCompile,
  external: externalCompile
};

function prepareConfig(options) {
  expect.options(options, ["contracts_build_directory"]);

  expect.one(options, ["contracts_directory", "files"]);

  // Use a config object to ensure we get the default sources.
  const config = Config.default().merge(options);

  config.compilersInfo = {};

  if (!config.resolver) {
    config.resolver = new Resolver(config);
  }

  if (!config.artifactor) {
    config.artifactor = new Artifactor(config.contracts_build_directory);
  }

  return config;
}

function multiPromisify(func) {
  return (...args) =>
    new Promise((accept, reject) => {
      const callback = (err, ...results) => {
        if (err) reject(err);

        accept(results);
      };

      func(...args, callback);
    });
}

var Contracts = {
  // contracts_directory: String. Directory where .sol files can be found.
  // contracts_build_directory: String. Directory where .sol.js files can be found and written to.
  // all: Boolean. Compile all sources found. Defaults to true. If false, will compare sources against built files
  //      in the build directory to see what needs to be compiled.
  // network_id: network id to link saved contract artifacts.
  // quiet: Boolean. Suppress output. Defaults to false.
  // strict: Boolean. Return compiler warnings as errors. Defaults to false.
  compile: callbackify(async function(options) {
    const config = prepareConfig(options);

    const compilers = config.compiler
      ? [config.compiler]
      : Object.keys(config.compilers);

    this.reportCompilationStarted(options);

    // convert to promise to compile+write
    const compilations = await this.compileSources(config, compilers);

    const collect = async compilations => {
      let result = {
        outputs: {},
        contracts: {}
      };

      for (let compilation of await Promise.all(compilations)) {
        let { compiler, output, contracts } = compilation;

        result.outputs[compiler] = output;

        for (let [name, abstraction] of Object.entries(contracts)) {
          result.contracts[name] = abstraction;
        }
      }

      return result;
    };

    this.reportCompilationFinished(options, config);
    return await collect(compilations);
  }),

  compileSources: async function(config, compilers) {
    return Promise.all(
      compilers.map(async compiler => {
        const compile = SUPPORTED_COMPILERS[compiler];
        if (!compile) throw new Error("Unsupported compiler: " + compiler);

        const compileFunc =
          config.all === true || config.compileAll === true
            ? compile.all
            : compile.necessary;

        let [contracts, output, compilerUsed] = await multiPromisify(
          compileFunc
        )(config);

        config.compilersInfo[compilerUsed.name] = {
          version: compilerUsed.version
        };

        if (contracts && Object.keys(contracts).length > 0) {
          await this.writeContracts(contracts, config);
        }

        return { compiler, contracts, output };
      })
    );
  },

  reportCompilationStarted: options => {
    const logger = options.logger || console;
    if (!options.quiet) {
      logger.log(OS.EOL + `Compiling your contracts`);
    }
  },

  reportCompilationFinished: (options, config) => {
    const logger = options.logger || console;
    const { compilersInfo } = config;
    if (!options.quiet) {
      logger.log(
        `    > artifacts written to ${options.contracts_build_directory}`
      );
      if (Object.keys(compilersInfo).length > 0) {
        logger.log(OS.EOL + `Compiled successfully using:`);
        for (const name in compilersInfo) {
          logger.log(`    > ${name}: ${compilersInfo[name].version}`);
        }
      } else {
        logger.log(OS.EOL + `Compilation successful`);
      }
      logger.log();
    }
  },

  writeContracts: async (contracts, options) => {
    await promisify(mkdirp)(options.contracts_build_directory);
    const extra_opts = { network_id: options.network_id };
    await options.artifactor.saveAll(contracts, extra_opts);
  }
};

module.exports = Contracts;
