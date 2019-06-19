const OS = require("os");
const path = require("path");
const Profiler = require("../profiler");
const CompileError = require("../compileerror");
const CompilerSupplier = require("../compilerSupplier");
const expect = require("truffle-expect");
const findContracts = require("truffle-contract-sources");
const Config = require("truffle-config");
const semver = require("semver");
const debug = require("debug")("compile"); // eslint-disable-line no-unused-vars

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
const compile = function(sources, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }

  if (options.logger === undefined) options.logger = console;

  const hasTargets =
    options.compilationTargets && options.compilationTargets.length;

  expect.options(options, ["contracts_directory", "compilers"]);
  expect.options(options.compilers, ["solc"]);

  options.compilers.solc.settings.evmVersion =
    options.compilers.solc.settings.evmVersion ||
    options.compilers.solc.evmVersion;
  options.compilers.solc.settings.optimizer =
    options.compilers.solc.settings.optimizer ||
    options.compilers.solc.optimizer ||
    {};

  // Grandfather in old solc config
  if (options.solc) {
    options.compilers.solc.settings.evmVersion = options.solc.evmVersion;
    options.compilers.solc.settings.optimizer = options.solc.optimizer;
  }

  // Certain situations result in `{}` as a value for compilationTargets
  // Previous implementations treated any value lacking `.length` as equivalent
  // to `[]`
  if (!options.compilationTargets || !options.compilationTargets.length) {
    options.compilationTargets = [];
  }

  // Ensure sources have operating system independent paths
  // i.e., convert backslashes to forward slashes; things like C: are left intact.
  const operatingSystemIndependentSources = {};
  const operatingSystemIndependentTargets = {};
  const originalPathMappings = {};

  Object.keys(sources).forEach(function(source) {
    // Turn all backslashes into forward slashes
    var replacement = source.replace(/\\/g, "/");

    // Turn G:/.../ into /G/.../ for Windows
    if (replacement.length >= 2 && replacement[1] === ":") {
      replacement = "/" + replacement;
      replacement = replacement.replace(":", "");
    }

    // Save the result
    operatingSystemIndependentSources[replacement] = sources[source];

    // Just substitute replacement for original in target case. It's
    // a disposable subset of `sources`
    if (hasTargets && options.compilationTargets.includes(source)) {
      operatingSystemIndependentTargets[replacement] = sources[source];
    }

    // Map the replacement back to the original source path.
    originalPathMappings[replacement] = source;
  });

  const defaultSelectors = {
    "": ["legacyAST", "ast"],
    "*": [
      "abi",
      "metadata",
      "evm.bytecode.object",
      "evm.bytecode.sourceMap",
      "evm.deployedBytecode.object",
      "evm.deployedBytecode.sourceMap",
      "userdoc",
      "devdoc"
    ]
  };

  // Specify compilation targets
  // Each target uses defaultSelectors, defaulting to single target `*` if targets are unspecified
  const outputSelection = {};
  const targets = operatingSystemIndependentTargets;
  const targetPaths = Object.keys(targets);

  targetPaths.length
    ? targetPaths.forEach(key => (outputSelection[key] = defaultSelectors))
    : (outputSelection["*"] = defaultSelectors);

  const solcStandardInput = {
    language: "Solidity",
    sources: {},
    settings: {
      evmVersion: options.compilers.solc.settings.evmVersion,
      optimizer: options.compilers.solc.settings.optimizer,
      outputSelection
    }
  };

  // Nothing to compile? Bail.
  if (Object.keys(sources).length === 0) {
    return callback(null, [], []);
  }

  Object.keys(operatingSystemIndependentSources).forEach(file_path => {
    solcStandardInput.sources[file_path] = {
      content: operatingSystemIndependentSources[file_path]
    };
  });

  // Load solc module only when compilation is actually required.
  const supplier = new CompilerSupplier(options.compilers.solc);

  supplier
    .load()
    .then(solc => {
      const result = solc.compile(JSON.stringify(solcStandardInput));

      const standardOutput = JSON.parse(result);

      let errors = standardOutput.errors || [];
      let warnings = [];

      if (options.strict !== true) {
        warnings = errors.filter(error => error.severity === "warning");

        errors = errors.filter(error => error.severity !== "warning");

        if (options.quiet !== true && warnings.length > 0) {
          options.logger.log(
            OS.EOL + "    > compilation warnings encountered:" + OS.EOL
          );
          options.logger.log(
            warnings.map(warning => warning.formattedMessage).join()
          );
        }
      }

      if (errors.length > 0) {
        options.logger.log("");
        errors = errors.map(error => error.formattedMessage).join();
        if (errors.includes("requires different compiler version")) {
          const contractSolcVer = errors.match(/pragma solidity[^;]*/gm)[0];
          const configSolcVer =
            options.compilers.solc.version || semver.valid(solc.version());
          errors = errors.concat(
            `\nError: Truffle is currently using solc ${configSolcVer}, but one or more of your contracts specify "${contractSolcVer}".\nPlease update your truffle config or pragma statement(s).\n(See https://truffleframework.com/docs/truffle/reference/configuration#compiler-configuration for information on\nconfiguring Truffle to use a specific solc compiler version.)`
          );
        }
        return callback(new CompileError(errors));
      }

      var files = [];
      Object.keys(standardOutput.sources).forEach(filename => {
        var source = standardOutput.sources[filename];
        files[source.id] = originalPathMappings[filename];
      });

      var returnVal = {};

      // This block has comments in it as it's being prepared for solc > 0.4.10
      Object.entries(standardOutput.contracts).forEach(entry => {
        const [sourcePath, filesContracts] = entry;

        Object.entries(filesContracts).forEach(entry => {
          var [contractName, contract] = entry;

          // All source will have a key, but only the compiled source will have
          // the evm output.
          if (!Object.keys(contract.evm).length) return;

          var contract_definition = {
            contract_name: contractName,
            sourcePath: originalPathMappings[sourcePath], // Save original source path, not modified ones
            source: operatingSystemIndependentSources[sourcePath],
            sourceMap: contract.evm.bytecode.sourceMap,
            deployedSourceMap: contract.evm.deployedBytecode.sourceMap,
            legacyAST: standardOutput.sources[sourcePath].legacyAST,
            ast: standardOutput.sources[sourcePath].ast,
            abi: contract.abi,
            metadata: contract.metadata,
            bytecode: "0x" + contract.evm.bytecode.object,
            deployedBytecode: "0x" + contract.evm.deployedBytecode.object,
            unlinked_binary: "0x" + contract.evm.bytecode.object, // deprecated
            compiler: {
              name: "solc",
              version: solc.version()
            },
            devdoc: contract.devdoc,
            userdoc: contract.userdoc
          };

          // Reorder ABI so functions are listed in the order they appear
          // in the source file. Solidity tests need to execute in their expected sequence.
          contract_definition.abi = orderABI(contract_definition);

          // Go through the link references and replace them with older-style
          // identifiers. We'll do this until we're ready to making a breaking
          // change to this code.
          Object.keys(contract.evm.bytecode.linkReferences).forEach(function(
            file_name
          ) {
            var fileLinks = contract.evm.bytecode.linkReferences[file_name];

            Object.keys(fileLinks).forEach(function(library_name) {
              var linkReferences = fileLinks[library_name] || [];

              contract_definition.bytecode = replaceLinkReferences(
                contract_definition.bytecode,
                linkReferences,
                library_name
              );
              contract_definition.unlinked_binary = replaceLinkReferences(
                contract_definition.unlinked_binary,
                linkReferences,
                library_name
              );
            });
          });

          // Now for the deployed bytecode
          Object.keys(contract.evm.deployedBytecode.linkReferences).forEach(
            function(file_name) {
              var fileLinks =
                contract.evm.deployedBytecode.linkReferences[file_name];

              Object.keys(fileLinks).forEach(function(library_name) {
                var linkReferences = fileLinks[library_name] || [];

                contract_definition.deployedBytecode = replaceLinkReferences(
                  contract_definition.deployedBytecode,
                  linkReferences,
                  library_name
                );
              });
            }
          );

          returnVal[contractName] = contract_definition;
        });
      });

      const compilerInfo = { name: "solc", version: solc.version() };

      callback(null, returnVal, files, compilerInfo);
    })
    .catch(callback);
};

function replaceLinkReferences(bytecode, linkReferences, libraryName) {
  var linkId = "__" + libraryName;

  while (linkId.length < 40) {
    linkId += "_";
  }

  linkReferences.forEach(function(ref) {
    // ref.start is a byte offset. Convert it to character offset.
    var start = ref.start * 2 + 2;

    bytecode =
      bytecode.substring(0, start) + linkId + bytecode.substring(start + 40);
  });

  return bytecode;
}

function orderABI({ abi, contract_name: contractName, ast }) {
  // AST can have multiple contract definitions, make sure we have the
  // one that matches our contract
  const contractDefinition = ast.nodes.find(
    ({ nodeType, name }) =>
      nodeType === "ContractDefinition" && name === contractName
  );

  if (!contractDefinition || !contractDefinition.nodes) {
    return abi;
  }

  // Find all function definitions
  const orderedFunctionNames = contractDefinition.nodes
    .filter(({ nodeType }) => nodeType === "FunctionDefinition")
    .map(({ name: functionName }) => functionName);

  // Put function names in a hash with their order, lowest first, for speed.
  const functionIndexes = orderedFunctionNames
    .map((functionName, index) => ({ [functionName]: index }))
    .reduce((a, b) => Object.assign({}, a, b), {});

  // Construct new ABI with functions at the end in source order
  return [
    ...abi.filter(({ name }) => functionIndexes[name] === undefined),

    // followed by the functions in the source order
    ...abi
      .filter(({ name }) => functionIndexes[name] !== undefined)
      .sort(
        ({ name: a }, { name: b }) => functionIndexes[a] - functionIndexes[b]
      )
  ];
}

// contracts_directory: String. Directory where .sol files can be found.
// quiet: Boolean. Suppress output. Defaults to false.
// strict: Boolean. Return compiler warnings as errors. Defaults to false.
compile.all = function(options, callback) {
  findContracts(options.contracts_directory, function(err, files) {
    if (err) return callback(err);

    options.paths = files;
    compile.with_dependencies(options, callback);
  });
};

// contracts_directory: String. Directory where .sol files can be found.
// build_directory: String. Optional. Directory where .sol.js files can be found. Only required if `all` is false.
// all: Boolean. Compile all sources found. Defaults to true. If false, will compare sources against built files
//      in the build directory to see what needs to be compiled.
// quiet: Boolean. Suppress output. Defaults to false.
// strict: Boolean. Return compiler warnings as errors. Defaults to false.
compile.necessary = function(options, callback) {
  options.logger = options.logger || console;

  Profiler.updated(options, function(err, updated) {
    if (err) return callback(err);

    if (updated.length === 0 && options.quiet !== true) {
      return callback(null, [], {});
    }

    options.paths = updated;
    compile.with_dependencies(options, callback);
  });
};

compile.with_dependencies = function(options, callback) {
  var self = this;

  options.logger = options.logger || console;
  options.contracts_directory = options.contracts_directory || process.cwd();

  expect.options(options, [
    "paths",
    "working_directory",
    "contracts_directory",
    "resolver"
  ]);

  var config = Config.default().merge(options);

  Profiler.required_sources(
    config.with({
      paths: options.paths,
      base_path: options.contracts_directory,
      resolver: options.resolver
    }),
    (err, allSources, required) => {
      if (err) return callback(err);

      var hasTargets = required.length;

      hasTargets
        ? self.display(required, options)
        : self.display(allSources, options);

      options.compilationTargets = required;
      compile(allSources, options, callback);
    }
  );
};

compile.display = function(paths, options) {
  if (options.quiet !== true) {
    if (!Array.isArray(paths)) {
      paths = Object.keys(paths);
    }

    const blacklistRegex = /^truffle\//;

    paths.sort().forEach(contract => {
      if (path.isAbsolute(contract)) {
        contract =
          "." + path.sep + path.relative(options.working_directory, contract);
      }
      if (contract.match(blacklistRegex)) return;
      options.logger.log("> Compiling " + contract);
    });
  }
};

compile.CompilerSupplier = CompilerSupplier;
module.exports = compile;
