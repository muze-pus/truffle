const debug = require("debug")("compile"); // eslint-disable-line no-unused-vars
const path = require("path");
const expect = require("@truffle/expect");
const findContracts = require("@truffle/contract-sources");
const Config = require("@truffle/config");
const Profiler = require("./profiler");
const CompilerSupplier = require("./compilerSupplier");
const { run } = require("./run");
const { normalizeOptions } = require("./legacy/options");

// Most basic of the compile commands. Takes a hash of sources, where
// the keys are file or module paths and the values are the bodies of
// the contracts. Does not evaulate dependencies that aren't already given.
//
// Default options:
// {
//   strict: false,
//   quiet: false,
//   logger: console
// }
const compile = async function (sources, options) {
  const compilation = await run(sources, normalizeOptions(options));
  return compilation.contracts.length > 0 ? [compilation] : [];
};

const Compile = {
  // contracts_directory: String. Directory where .sol files can be found.
  // quiet: Boolean. Suppress output. Defaults to false.
  // strict: Boolean. Return compiler warnings as errors. Defaults to false.
  // files: Array<String>. Explicit files to compile besides detected sources
  all: async function (options) {
    const paths = [
      ...new Set([
        ...(await findContracts(options.contracts_directory)),
        ...(options.files || [])
      ])
    ];

    return await this.withDependencies(
      Config.default().merge(options).merge({ paths })
    );
  },

  // contracts_directory: String. Directory where .sol files can be found.
  // build_directory: String. Optional. Directory where .sol.js files can be found. Only required if `all` is false.
  // all: Boolean. Compile all sources found. Defaults to true. If false, will compare sources against built files
  //      in the build directory to see what needs to be compiled.
  // quiet: Boolean. Suppress output. Defaults to false.
  // strict: Boolean. Return compiler warnings as errors. Defaults to false.
  // files: Array<String>. Explicit files to compile besides detected sources
  necessary: async function (options) {
    options.logger = options.logger || console;

    const paths = await Profiler.updated(options);

    return await this.withDependencies(
      Config.default().merge(options).merge({ paths })
    );
  },

  withDependencies: async function (options) {
    options.logger = options.logger || console;
    options.contracts_directory = options.contracts_directory || process.cwd();

    expect.options(options, [
      "paths",
      "working_directory",
      "contracts_directory",
      "resolver"
    ]);

    const config = Config.default().merge(options);
    const { allSources, compilationTargets } = await Profiler.requiredSources(
      config.with({
        paths: options.paths,
        base_path: options.contracts_directory,
        resolver: options.resolver
      })
    );

    const hasTargets = compilationTargets.length;

    hasTargets
      ? this.display(compilationTargets, options)
      : this.display(allSources, options);

    options.compilationTargets = compilationTargets;
    const { sourceIndexes, contracts, compiler } = await run(
      allSources,
      normalizeOptions(options)
    );
    const { name, version } = compiler;
    // returns CompilerResult - see @truffle/compile-common
    return contracts.length > 0
      ? [
          {
            sourceIndexes,
            contracts,
            compiler: { name, version }
          }
        ]
      : [];
  },

  display: function (paths, options) {
    if (options.quiet !== true) {
      if (!Array.isArray(paths)) {
        paths = Object.keys(paths);
      }

      const blacklistRegex = /^truffle\//;

      const sources = paths
        .sort()
        .map(contract => {
          if (path.isAbsolute(contract)) {
            contract =
              "." +
              path.sep +
              path.relative(options.working_directory, contract);
          }
          if (contract.match(blacklistRegex)) return;
          return contract;
        })
        .filter(contract => contract);
      options.events.emit("compile:sourcesToCompile", {
        sourceFileNames: sources
      });
    }
  }
};

module.exports = {
  compile,
  Compile,
  CompilerSupplier
};
