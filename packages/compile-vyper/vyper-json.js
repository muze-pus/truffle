const debug = require("debug")("compile-vyper:vyper-json");
const execSync = require("child_process").execSync;
const path = require("path");
const semver = require("semver");
const Common = require("@truffle/compile-common");
const partition = require("lodash.partition");

//NOTE: this file has a fair bit of copypaste-with-modifications
//from compile-solidity/run.js, so be warned...
//(some has since been factored into compile-common, but not all)

function compileJson({ sources: rawSources, options, version, command }) {
  const compiler = { name: "vyper", version };

  //in order to better support absolute Vyper imports, we pretend that
  //the contracts directory is the root directory.  note this means that
  //if an imported source from somewhere other than FS uses an absolute
  //import to refer to its own project root, it won't work.  But, oh well.
  const {
    sources,
    targets,
    originalSourcePaths
  } = Common.Sources.collectSources(
    rawSources,
    options.compilationTargets,
    options.contracts_directory
  );

  //Vyper complains if we give it a source that is not also a target,
  //*unless* we give it as an interface.  So we have to split that out.
  //(JSON files also must always be interfaces)
  const [properSourcePaths, interfacePaths] = partition(
    Object.keys(sources),
    targets.length > 0
      ? sourcePath => !sourcePath.endsWith(".json") &&
        targets.includes(sourcePath)
      : sourcePath => !sourcePath.endsWith(".json")
  );

  const properSources = Object.assign(
    {},
    ...properSourcePaths.map(sourcePath => ({
      [sourcePath]: sources[sourcePath]
    }))
  );

  const interfaces = Object.assign(
    {},
    ...interfacePaths.map(sourcePath => ({
      [sourcePath]: sources[sourcePath]
    }))
  );

  // construct compiler input
  const compilerInput = prepareCompilerInput({
    sources: properSources,
    interfaces,
    settings: options.compilers.vyper.settings || {},
    version
  });

  // perform compilation
  const rawCompilerOutput = invokeCompiler({
    compilerInput,
    command
  });
  debug("rawCompilerOutput: %O", rawCompilerOutput);

  // handle warnings as errors if options.strict
  // log if not options.quiet
  const { warnings, errors } = detectErrors({
    compilerOutput: rawCompilerOutput,
    options
  });
  if (warnings.length > 0) {
    options.events.emit("compile:warnings", { warnings });
  }

  if (errors.length > 0) {
    if (!options.quiet) {
      options.logger.log("");
    }

    throw new Common.Errors.CompileError(errors);
  }

  const compilerOutput = correctPaths(rawCompilerOutput);

  const outputSources = processAllSources({
    sources,
    compilerOutput,
    originalSourcePaths
  });
  const sourceIndexes = outputSources.map(source => source.sourcePath);
  const compilation = {
    sourceIndexes,
    contracts: processContracts({
      sources,
      compilerOutput,
      version,
      originalSourcePaths
    }),
    sources: outputSources,
    compiler
  };

  return { compilations: [compilation] };
}

function invokeCompiler({ compilerInput, command }) {
  const inputString = JSON.stringify(compilerInput);
  const outputString = execVyperJson(inputString, command);
  return JSON.parse(outputString);
}

function execVyperJson(inputString, command) {
  return execSync(command, {
    input: inputString,
    maxBuffer: 1024 * 1024 * 10 //I guess?? copied from compile-solidity
  });
}

function prepareCompilerInput({
  sources,
  settings,
  interfaces,
  version
}) {
  const outputSelection = prepareOutputSelection({ version });
  return {
    language: "Vyper",
    sources: prepareSources({ sources }),
    interfaces: prepareInterfaces({ interfaces }),
    settings: {
      evmVersion: settings.evmVersion,
      outputSelection
    },
    //older versions of vyper require outputSelection *outside* of settings.
    //we'll put it in both places for compatibility.
    outputSelection
  };
}

function prepareSources({ sources }) {
  return Object.entries(sources)
    .map(([sourcePath, content]) => ({ [sourcePath]: { content } }))
    .reduce((a, b) => Object.assign({}, a, b), {});
}

function prepareInterfaces({ interfaces }) {
  return Object.entries(interfaces)
    .map(([sourcePath, content]) =>
      sourcePath.endsWith(".json") //for JSON we need the ABI *object*, not JSON!
        ? { [sourcePath]: { abi: JSON.parse(content) } }
        : { [sourcePath]: { content } }
     )
    .reduce((a, b) => Object.assign({}, a, b), {});
}

function prepareOutputSelection({ version }) {
  //Vyper uses a simpler output selection format
  //than solc does; it also supports solc's format,
  //but I've gone with the simpler version here
  let defaultSelectors = [
    "abi",
    "ast",
    "evm.bytecode.object",
    //we have to omit sourceMap here, as annoyingly,
    //Vyper errors if you give it a not-yet-supported output selection...
    "evm.deployedBytecode.object",
    "evm.deployedBytecode.sourceMap"
  ];
  if (
    semver.satisfies(version, ">=0.1.0-beta.17", {
      loose: true,
      includePrerelase: true
    })
  ) {
    //again, due to Vyper erroring if you ask for output it doesn't know about,
    //we have to only add these to the output if we're on a sufficiently recent
    //version
    const additionalSelectors = ["userdoc", "devdoc"];
    defaultSelectors = defaultSelectors.concat(additionalSelectors);
  }

  //because we've already filtered down the sources to match the targets,
  //we can just say that the targets are everything
  return {
    "*": defaultSelectors
  };
}

//this also is copy-pasted, but minus some complications
function detectErrors({ compilerOutput: { errors: outputErrors }, options }) {
  outputErrors = outputErrors || [];
  const rawErrors = options.strict
    ? outputErrors
    : outputErrors.filter(({ severity }) => severity !== "warning");

  const rawWarnings = options.strict
    ? [] // none of those in strict mode
    : outputErrors.filter(({ severity }) => severity === "warning");

  // extract messages
  // NOTE: sufficiently old Vyper versions don't have formattedMessage, so we use message
  // instead in those cases
  let errors = rawErrors
    .map(({ formattedMessage, message }) => formattedMessage || message)
    .join();
  const warnings = rawWarnings.map(
    ({ formattedMessage, message }) => formattedMessage || message
  );

  return { warnings, errors };
}

//warning: copypaste
function processAllSources({ sources, compilerOutput, originalSourcePaths }) {
  if (!compilerOutput.sources) return [];
  let outputSources = [];
  for (const [sourcePath, { id, ast }] of Object.entries(
    compilerOutput.sources
  )) {
    outputSources[id] = {
      sourcePath: originalSourcePaths[sourcePath],
      contents: sources[sourcePath],
      ast,
      language: "Vyper"
    };
  }
  return outputSources;
}

function processContracts({
  compilerOutput,
  sources,
  version,
  originalSourcePaths
}) {
  if (!compilerOutput.contracts) return [];
  return (
    Object.entries(compilerOutput.contracts)
      // map to [[{ source, contractName, contract }]]
      .map(([sourcePath, sourceContracts]) =>
        Object.entries(sourceContracts).map(([contractName, contract]) => ({
          // if extension is .py, remove second extension from contract name (HACK)
          contractName:
            path.extname(sourcePath) !== ".py"
              ? contractName
              : path.basename(contractName, path.extname(contractName)),
          contract,
          source: {
            ast: compilerOutput.sources[sourcePath].ast,
            contents: sources[sourcePath],
            sourcePath
          }
        }))
      )
      // and flatten
      .reduce((a, b) => [...a, ...b], [])

      // All source will have a key, but only the compiled source will have
      // the evm output.
      .filter(({ contract: { evm } }) => Object.keys(evm).length > 0)

      // convert to output format
      .map(
        ({
          contractName,
          contract: {
            evm: {
              bytecode: { object: bytecode },
              deployedBytecode: {
                sourceMap: deployedSourceMap,
                object: deployedBytecode
              }
            },
            abi,
            devdoc,
            userdoc
          },
          source: { ast, sourcePath: transformedSourcePath, contents: source }
        }) => ({
          contractName,
          abi,
          devdoc,
          userdoc,
          sourcePath: originalSourcePaths[transformedSourcePath],
          source,
          deployedSourceMap,
          ast,
          bytecode: {
            bytes: bytecode.slice(2), //Vyper uses a "0x" prefix
            linkReferences: [] //no libraries in Vyper
          },
          deployedBytecode: {
            bytes: deployedBytecode.slice(2), //Vyper uses a "0x" prefix
            linkReferences: [] //no libraries in Vyper
          },
          compiler: {
            name: "vyper",
            version
          }
        })
      )
  );
}

function correctPaths(compilerOutput) {
  return {
    compiler: compilerOutput.compiler,
    errors: compilerOutput.errors,
    sources: fixKeys(compilerOutput.sources),
    contracts: fixKeys(compilerOutput.contracts)
  };
}

function fixKeys(pathKeyedObject) {
  return Object.assign(
    {},
    ...Object.entries(pathKeyedObject).map(([key, value]) => ({
      [fixPath(key)]: value
    }))
  );
}

function fixPath(path) {
  if (path[0] === "/") {
    return path;
  } else {
    return "/" + path;
  }
}

module.exports = {
  compileJson,
  execVyperJson
};
