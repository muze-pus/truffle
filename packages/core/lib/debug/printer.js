const debugModule = require("debug");
const debug = debugModule("lib:debug:printer");

const path = require("path");

const DebugUtils = require("@truffle/debug-utils");
const Codec = require("@truffle/codec");
const colors = require("colors");
const Interpreter = require("js-interpreter");

const selectors = require("@truffle/debugger").selectors;
const {
  session,
  solidity,
  trace,
  controller,
  data,
  evm,
  stacktrace
} = selectors;

class DebugPrinter {
  constructor(config, session) {
    this.config = config;
    this.session = session;
    this.select = expr => {
      let selector, result;

      try {
        selector = expr
          .split(".")
          .reduce((sel, next) => (next.length ? sel[next] : sel), selectors);
      } catch (_) {
        throw new Error("Unknown selector: %s", expr);
      }

      // throws its own exception
      // note: we avoid using this.session so that this
      // can be called from js-interpreter
      result = session.view(selector);

      return result;
    };

    const colorizeSourceObject = source => {
      const { source: raw, language } = source;
      const detabbed = DebugUtils.tabsToSpaces(raw);
      return DebugUtils.colorize(detabbed, language);
    };

    this.colorizedSources = Object.assign(
      {},
      ...Object.entries(this.session.view(solidity.views.sources)).map(
        ([id, source]) => ({
          [id]: colorizeSourceObject(source)
        })
      )
    );

    this.printouts = new Set(["sta"]);
    this.locations = ["sto", "cal", "mem", "sta"]; //should remain constant
  }

  print(...args) {
    this.config.logger.log(...args);
  }

  printSessionLoaded() {
    this.printAddressesAffected();
    this.warnIfNoSteps();
    this.printHelp();
    debug("Help printed");
    this.printFile();
    debug("File printed");
    this.printState();
    debug("State printed");
  }

  printSessionError() {
    this.print(this.session.view(session.status.error));
    this.printHelp();
  }

  printAddressesAffected() {
    const affectedInstances = this.session.view(session.info.affectedInstances);

    this.config.logger.log("");
    this.config.logger.log("Addresses affected:");
    this.config.logger.log(
      DebugUtils.formatAffectedInstances(affectedInstances)
    );
  }

  warnIfNoSteps() {
    if (this.session.view(trace.steps).length === 0) {
      this.config.logger.log(
        `${colors.bold(
          "Warning:"
        )} this transaction has no trace steps. This may happen if you are attempting to debug a transaction sent to an externally-owned account, or if the node you are connecting to failed to produce a trace for some reason. Please check your configuration and try again.`
      );
    }
  }

  printHelp(lastCommand) {
    this.config.logger.log("");
    this.config.logger.log(DebugUtils.formatHelp(lastCommand));
  }

  printFile(location = this.session.view(controller.current.location)) {
    let message = "";

    const sourcePath = location.source.sourcePath;

    if (sourcePath) {
      message += path.basename(sourcePath);
    } else {
      message += "?";
    }

    this.config.logger.log("");
    this.config.logger.log(message + ":");
  }

  printState(
    contextBefore = 2,
    contextAfter = 0,
    location = this.session.view(controller.current.location)
  ) {
    const {
      source: { id: sourceId },
      sourceRange: range
    } = location;

    if (sourceId === undefined) {
      this.config.logger.log();
      this.config.logger.log("1: // No source code found.");
      this.config.logger.log("");
      return;
    }

    //we don't just get extract the source text from the location because passed-in location may be
    //missing the source text
    const source = this.session.view(solidity.views.sources)[sourceId].source;
    const colorizedSource = this.colorizedSources[sourceId];

    debug("range: %o", range);

    // We were splitting on OS.EOL, but it turns out on Windows,
    // in some environments (perhaps?) line breaks are still denoted by just \n
    const splitLines = str => str.split(/\r?\n/g);

    const lines = splitLines(source);
    const colorizedLines = splitLines(colorizedSource);

    this.config.logger.log("");

    //HACK -- the line-pointer formatter doesn't work right with colorized
    //lines, so we pass in the uncolored version too
    this.config.logger.log(
      DebugUtils.formatRangeLines(
        colorizedLines,
        range.lines,
        lines,
        contextBefore,
        contextAfter
      )
    );

    this.config.logger.log("");
  }

  printInstruction(locations = this.printouts) {
    const instruction = this.session.view(solidity.current.instruction);
    const step = this.session.view(trace.step);
    const traceIndex = this.session.view(trace.index);
    const totalSteps = this.session.view(trace.steps).length;
    //note calldata will be a Uint8Array, not a hex string or array of such
    const calldata = this.session.view(data.current.state.calldata);
    //storage here is an object mapping hex words to hex words, all w/o 0x prefix
    const storage = this.session.view(evm.current.codex.storage);

    this.config.logger.log("");
    if (locations.has("sto")) {
      this.config.logger.log(DebugUtils.formatStorage(storage));
      this.config.logger.log("");
    }
    if (locations.has("cal")) {
      this.config.logger.log(DebugUtils.formatCalldata(calldata));
      this.config.logger.log("");
    }
    if (locations.has("mem")) {
      this.config.logger.log(DebugUtils.formatMemory(step.memory));
      this.config.logger.log("");
    }
    if (locations.has("sta")) {
      this.config.logger.log(DebugUtils.formatStack(step.stack));
      this.config.logger.log("");
    }
    this.config.logger.log(
      DebugUtils.formatInstruction(traceIndex + 1, totalSteps, instruction)
    );
    this.config.logger.log(DebugUtils.formatPC(step.pc));
    this.config.logger.log("");
    this.config.logger.log(step.gas + " gas remaining");
  }

  /**
   * @param {string} selector
   */
  printSelector(selector) {
    const result = this.select(selector);
    const debugSelector = debugModule(selector);
    debugSelector.enabled = true;
    debugSelector("%O", result);
  }

  printWatchExpressions(expressions) {
    if (expressions.size === 0) {
      this.config.logger.log("No watch expressions added.");
      return;
    }

    this.config.logger.log("");
    for (const expression of expressions) {
      this.config.logger.log("  " + expression);
    }
  }

  printBreakpoints() {
    const sources = this.session.view(solidity.views.sources);
    const sourceNames = Object.assign(
      //note: only include user sources
      {},
      ...Object.entries(sources).map(([id, source]) => ({
        [id]: path.basename(source.sourcePath)
      }))
    );
    const breakpoints = this.session.view(controller.breakpoints);
    if (breakpoints.length > 0) {
      for (let breakpoint of this.session.view(controller.breakpoints)) {
        let currentLocation = this.session.view(controller.current.location);
        let locationMessage = DebugUtils.formatBreakpointLocation(
          breakpoint,
          currentLocation.node !== undefined &&
            breakpoint.sourceId === currentLocation.source.sourceId &&
            breakpoint.node === currentLocation.astRef,
          currentLocation.source.id,
          sourceNames
        );
        this.config.logger.log("  Breakpoint at " + locationMessage);
      }
    } else {
      this.config.logger.log("No breakpoints added.");
    }
  }

  printGeneratedSourcesState() {
    if (this.session.view(controller.stepIntoInternalSources)) {
      this.config.logger.log("Generated sources are turned on.");
    } else {
      this.config.logger.log("Generated sources are turned off.");
    }
  }

  //this doesn't really *need* to be async as we could use codec directly, but, eh
  async printRevertMessage() {
    this.config.logger.log(
      DebugUtils.truffleColors.red("Transaction halted with a RUNTIME ERROR.")
    );
    this.config.logger.log("");
    const revertDecodings = await this.session.returnValue(); //in this context we know it's a revert
    debug("revertDecodings: %o", revertDecodings);
    switch (revertDecodings.length) {
      case 0:
        this.config.logger.log(
          "There was revert data, but it could not be decoded."
        );
        break;
      case 1:
        const revertDecoding = revertDecodings[0];
        switch (revertDecoding.kind) {
          case "failure":
            this.config.logger.log(
              "There was no revert message.  This may be due to an in intentional halting expression, such as assert(), revert(), or require(), or could be due to an unintentional exception such as out-of-gas exceptions."
            );
            break;
          case "revert":
            const signature =
              Codec.AbiData.Utils.abiSignature(revertDecoding.abi);
            switch (signature) {
              case "Error(string)":
                const revertStringInfo =
                  revertDecoding.arguments[0].value.value;
                let revertString;
                switch (revertStringInfo.kind) {
                  case "valid":
                    revertString = revertStringInfo.asString;
                    this.config.logger.log(`Revert message: ${revertString}`);
                    break;
                  case "malformed":
                    //turn into a JS string while smoothing over invalid UTF-8
                    //slice 2 to remove 0x prefix
                    revertString = Buffer.from(
                      revertStringInfo.asHex.slice(2),
                      "hex"
                    ).toString();
                    this.config.logger.log(`Revert message: ${revertString}`);
                    this.config.logger.log(
                      `${colors.bold(
                        "Warning:"
                      )} This message contained invalid UTF-8.`
                    );
                    break;
                }
                break;
              case "Panic(uint)":
                const panicCode = revertDecoding.arguments[0].value.value.asBN;
                const panicString = DebugUtils.panicString(panicCode, true); //get verbose panic string :)
                this.config.logger.log(
                  `Panic: Code 0x${panicCode.toString(
                    16
                  )}. This code indicates that ${panicString.toLowerCase()}`
                );
                break;
              default:
                this.config.logger.log("The following error was thrown:");
                this.config.logger.log(DebugUtils.formatCustomError(revertDecoding, 2));
            }
            break;
        }
        break;
      default:
        this.config.logger.log(
          "There was revert data, but it could not be unambiguously decoded."
        );
        this.config.logger.log("Possible interpretations:");
        for (const decoding of revertDecodings) {
          this.config.logger.log(DebugUtils.formatCustomError(revertDecoding, 2));
        }
        break;
    }
    this.config.logger.log(
      "Please inspect your transaction parameters and contract code to determine the meaning of this error."
    );
  }

  async printReturnValue() {
    //note: when printing revert messages, this will do so in a somewhat
    //different way than printRevertMessage does
    const allocationFound = Boolean(
      this.session.view(data.current.returnAllocation)
    );
    const decodings = await this.session.returnValue();
    debug("decodings: %o", decodings);
    if (!allocationFound && decodings.length === 0) {
      //case 1: no allocation found, decoding failed
      this.config.logger.log("");
      this.config.logger.log(
        "A value was returned but it could not be decoded."
      );
      this.config.logger.log("");
    } else if (!allocationFound && decodings[0].status === true) {
      //case 2: no allocation found, decoding succeeded, but not a revert
      //(i.e. it's a presumed selfdestruct; no value was returned)
      //do nothing
    } else if (allocationFound && decodings.length === 0) {
      //case 3: allocation found but decoding failed
      this.config.logger.log("");
      this.config.logger.log("The return value could not be decoded.");
      this.config.logger.log("");
    } else if (allocationFound && decodings[0].kind === "selfdestruct") {
      //case 4: allocation found, apparent self-destruct (note due to the use of [0] this
      //won't occur if no return value was expected, as return takes priority over selfdestruct)
      //Oops -- in an actual selfdestruct, we won't have the code! >_>
      //(Not until reconstruct mode exists...) Oh well, leaving this in
      this.config.logger.log("");
      this.config.logger.log(
        "No value was returned even though one was expected.  This may indicate a self-destruct."
      );
      this.config.logger.log("");
    } else if (decodings[0].kind === "failure") {
      //case 5: revert (no message)
      this.config.logger.log("");
      this.config.logger.log("There was no revert message.");
      this.config.logger.log("");
    } else if (decodings[0].kind === "unknownbytecode") {
      //case 6: unknown bytecode
      this.config.logger.log("");
      this.config.logger.log(
        "Bytecode was returned, but it could not be identified."
      );
      this.config.logger.log("");
    } else if (
      decodings[0].kind === "return" &&
      decodings[0].arguments.length === 0
    ) {
      //case 7: return values but with no content
      //do nothing
    } else if (decodings[0].kind === "bytecode") {
      //case 8: known bytecode
      this.config.logger.log("");
      const decoding = decodings[0];
      const contractKind = decoding.contractKind || "contract";
      if (decoding.address !== undefined) {
        this.config.logger.log(
          `Returned bytecode for a ${contractKind} ${decoding.class.typeName} at ${decoding.address}.`
        );
      } else {
        this.config.logger.log(
          `Returned bytecode for a ${contractKind} ${decoding.class.typeName}.`
        );
      }
      if (decoding.immutables && decoding.immutables.length > 0) {
        this.config.logger.log("Immutable values:");
        const prefixes = decoding.immutables.map(
          ({ name, class: { typeName } }) => `${typeName}.${name}: `
        );
        const maxLength = Math.max(...prefixes.map(prefix => prefix.length));
        const paddedPrefixes = prefixes.map(prefix =>
          prefix.padStart(maxLength)
        );
        for (let index = 0; index < decoding.immutables.length; index++) {
          const { value } = decoding.immutables[index];
          const prefix = paddedPrefixes[index];
          const formatted = DebugUtils.formatValue(value, maxLength);
          this.config.logger.log(prefix + formatted);
        }
      }
      this.config.logger.log("");
    } else if (
      decodings[0].kind === "revert" &&
      decodings.filter(decoding => decoding.kind === "revert").length === 1
    ) {
      //case 9: revert (with message) (unambiguous)
      const decoding = decodings[0];
      const signature = Codec.AbiData.Utils.abiSignature(decoding.abi);
      this.config.logger.log("");
      switch (signature) {
        case "Error(string)": {
          //case 9a: revert string
          const prefix = "Revert string: ";
          const value = decodings[0].arguments[0].value;
          const formatted = DebugUtils.formatValue(value, prefix.length);
          this.config.logger.log(prefix + formatted);
          break;
        }
        case "Panic(uint)": {
          //case 9b: panic code
          const prefix = "Panic code: ";
          const value = decodings[0].arguments[0].value;
          const formatted = DebugUtils.formatValue(value, prefix.length);
          const meaning = DebugUtils.panicString(value.value.asBN);
          this.config.logger.log(`${prefix} ${formatted} (${meaning})`);
          break;
        }
        default:
          //case 9c: custom error
          this.config.logger.log("Error thrown:");
          this.config.logger.log(DebugUtils.formatCustomError(decodings[0], 2));
      }
      this.config.logger.log("");
    } else if (
      decodings[0].kind === "revert" &&
      decodings.filter(decoding => decoding.kind === "revert").length > 1
    ) {
      //case 10: ambiguous revert with message
      this.config.logger.log("Ambiguous error thrown, possible interpretations:");
      for (const decoding of revertDecodings) {
        if (decoding.kind !== "revert") {
          break;
        }
        this.config.logger.log(DebugUtils.formatCustomError(decoding, 2));
      }
    } else if (
      decodings[0].kind === "return" &&
      decodings[0].arguments.length > 0
    ) {
      //case 11: actual return values to print!
      this.config.logger.log("");
      const values = decodings[0].arguments;
      if (values.length === 1 && !values[0].name) {
        //case 11a: if there's only one value and it's unnamed
        const value = values[0].value;
        const prefix = "Returned value: ";
        const formatted = DebugUtils.formatValue(value, prefix.length);
        this.config.logger.log(prefix + formatted);
      } else {
        //case 11b: otherwise
        this.config.logger.log("Returned values:");
        const prefixes = values.map(({ name }, index) =>
          name ? `${name}: ` : `Component #${index + 1}: `
        );
        const maxLength = Math.max(...prefixes.map(prefix => prefix.length));
        const paddedPrefixes = prefixes.map(prefix =>
          prefix.padStart(maxLength)
        );
        for (let index = 0; index < values.length; index++) {
          const { value } = values[index];
          const prefix = paddedPrefixes[index];
          const formatted = DebugUtils.formatValue(value, maxLength);
          this.config.logger.log(prefix + formatted);
        }
      }
      this.config.logger.log("");
    } else if (decodings[0].kind === "returnmessage") {
      //case 12: raw binary data
      this.config.logger.log("");
      const fallbackOutputDefinition = this.session.view(
        data.current.fallbackOutputForContext
      );
      const name = (fallbackOutputDefinition || {}).name;
      const prettyData = `${colors.green("hex")}${DebugUtils.formatValue(
        decodings[0].data.slice(2), //remove '0x'
        0,
        true
      )}`;
      if (name) {
        //case 12a: it has a name
        this.config.logger.log("Returned values:");
        this.config.logger.log(`${name}: ${prettyData}`);
      } else {
        //case 12b: it doesn't
        this.config.logger.log(`Returned value: ${prettyData}`);
      }
      //it's already a string, so we'll pass the nativized parameter
      //and hack this together :)
      //also, since we only have one thing and it's a string, we'll skip
      //fancy indent processing
      this.config.logger.log("");
    }
  }

  printStacktrace(final) {
    this.config.logger.log(final ? "Stacktrace:" : "Call stack:");
    let report = final
      ? this.session.view(stacktrace.current.finalReport)
      : this.session.view(stacktrace.current.report);
    this.config.logger.log(DebugUtils.formatStacktrace(report));
  }

  printErrorLocation(linesBefore, linesAfter) {
    const stacktraceReport = this.session.view(stacktrace.current.finalReport);
    const lastUserFrame = stacktraceReport
      .slice()
      .reverse() //clone before reversing, reverse is in-place!
      .find(frame => !frame.location.internal);
    if (lastUserFrame) {
      this.config.logger.log("");
      this.config.logger.log(
        DebugUtils.truffleColors.red("Location of error:")
      );
      this.printFile(lastUserFrame.location);
      this.printState(linesBefore, linesAfter, lastUserFrame.location);
    }
  }

  async printWatchExpressionsResults(expressions) {
    debug("expressions %o", expressions);
    for (let expression of expressions) {
      this.config.logger.log(expression);
      // Add some padding. Note: This won't work with all loggers,
      // meaning it's not portable. But doing this now so we can get something
      // pretty until we can build more architecture around this.
      // Note: Selector results already have padding, so this isn't needed.
      if (expression[0] === ":") {
        process.stdout.write("  ");
      }
      await this.printWatchExpressionResult(expression);
    }
  }

  async printWatchExpressionResult(expression) {
    const type = expression[0];
    const exprArgs = expression.substring(1);

    if (type === "!") {
      this.printSelector(exprArgs);
    } else {
      await this.evalAndPrintExpression(exprArgs, 2, true);
    }
  }

  async printVariables() {
    const values = await this.session.variables();
    const sections = this.session.view(data.current.identifiers.sections);

    const sectionNames = {
      builtin: "Solidity built-ins",
      global: "Global constants",
      contract: "Contract variables",
      local: "Local variables"
    };

    this.config.logger.log();

    for (const [section, variables] of Object.entries(sections)) {
      if (variables.length > 0) {
        this.config.logger.log(sectionNames[section] + ":");
        // Get the length of the longest name.
        const longestNameLength = variables.reduce((longest, name) => {
          return name.length > longest ? name.length : longest;
        }, -Infinity);
        for (const variable of variables) {
          const paddedName = variable.padStart(longestNameLength) + ":";
          const value = values[variable];
          const formatted = DebugUtils.formatValue(
            value,
            longestNameLength + 5
          );
          this.config.logger.log("  " + paddedName, formatted);
        }
        this.config.logger.log();
      }
    }
  }

  /**
   * @param {string} raw - user input for watch expression
   *
   * performs pre-processing on `raw`, using !<...> delimeters to refer
   * to selector expressions.
   *
   * e.g., to see a particular part of the current trace step's stack:
   *
   *    debug(development:0x4228cdd1...)>
   *
   *        :!<trace.step.stack>[1]
   */
  async evalAndPrintExpression(raw, indent, suppress) {
    let variables = await this.session.variables();

    //if we're just dealing with a single variable, handle that case
    //separately (so that we can do things in a better way for that
    //case)
    let variable = raw.trim();
    if (variable in variables) {
      let formatted = DebugUtils.formatValue(variables[variable], indent);
      this.config.logger.log(formatted);
      this.config.logger.log();
      return;
    }
    debug("expression case");

    // converts all !<...> expressions to JS-valid selector requests
    const preprocessSelectors = expr => {
      const regex = /!<([^>]+)>/g;
      const select = "$"; // expect repl context to have this func
      const replacer = (_, selector) => `${select}("${selector}")`;

      return expr.replace(regex, replacer);
    };

    //HACK
    //if we're not in the single-variable case, we'll need to do some
    //things to Javascriptify our variables so that the JS syntax for
    //using them is closer to the Solidity syntax
    let context = Codec.Format.Utils.Inspect.unsafeNativizeVariables(variables);

    //HACK -- we can't use "this" as a variable name, so we're going to
    //find an available replacement name, and then modify the context
    //and expression appropriately
    let pseudoThis = "_this";
    while (pseudoThis in context) {
      pseudoThis = "_" + pseudoThis;
    }
    //in addition to pseudoThis, which replaces this, we also have
    //pseudoPseudoThis, which replaces pseudoThis in order to ensure
    //that any uses of pseudoThis yield an error instead of showing this
    let pseudoPseudoThis = "thereisnovariableofthatname";
    while (pseudoPseudoThis in context) {
      pseudoPseudoThis = "_" + pseudoPseudoThis;
    }
    context = DebugUtils.cleanThis(context, pseudoThis);
    let expr = raw.replace(
      //those characters in [] are the legal JS variable name characters
      //note that pseudoThis contains no special characters
      new RegExp("(?<![a-zA-Z0-9_$])" + pseudoThis + "(?![a-zA-Z0-9_$])"),
      pseudoPseudoThis
    );
    expr = expr.replace(
      //those characters in [] are the legal JS variable name characters
      /(?<![a-zA-Z0-9_$])this(?![a-zA-Z0-9_$])/,
      pseudoThis
    );
    //note that pseudoThis contains no dollar signs to screw things up

    expr = preprocessSelectors(expr);

    try {
      const result = this.safelyEvaluateWithSelectors(expr, context);
      const formatted = DebugUtils.formatValue(result, indent, true);
      this.config.logger.log(formatted);
      this.config.logger.log();
    } catch (e) {
      if (!suppress) {
        this.config.logger.log(e);
      } else {
        this.config.logger.log(DebugUtils.formatValue(undefined, indent, true));
      }
    }
  }

  //evaluates expression with the variables in context,
  //but also has `$` as a variable that is the select function
  safelyEvaluateWithSelectors(expression, context) {
    const select = this.select;
    let interpreter;
    interpreter = new Interpreter(expression, function (
      interpreter,
      globalObject
    ) {
      //first let's set up our select function (which will be called $)
      interpreter.setProperty(
        globalObject,
        "$",
        interpreter.createNativeFunction(selectorName => {
          debug("selecting %s", selectorName);
          return interpreter.nativeToPseudo(select(selectorName));
        })
      );
      //now let's set up the variables
      for (const [variable, value] of Object.entries(context)) {
        try {
          debug("variable: %s", variable);
          //note: circular objects wll raise an exception here and get excluded.
          interpreter.setProperty(
            globalObject,
            variable,
            interpreter.nativeToPseudo(value)
          );
        } catch (_) {
          debug("failure");
          //just omit things that don't work
        }
      }
    });
    interpreter.run();
    return interpreter.pseudoToNative(interpreter.value);
  }
}

module.exports = {
  DebugPrinter
};
