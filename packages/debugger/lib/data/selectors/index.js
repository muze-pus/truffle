import debugModule from "debug";
const debug = debugModule("debugger:data:selectors");

import { createSelectorTree, createLeaf } from "reselect-tree";
import jsonpointer from "json-pointer";
import flatten from "lodash.flatten";
import semver from "semver";

import { stableKeccak256, makePath } from "lib/helpers";

import trace from "lib/trace/selectors";
import evm from "lib/evm/selectors";
import solidity from "lib/solidity/selectors";

import * as Codec from "@truffle/codec";

/**
 * @private
 */
const identity = x => x;

function findAncestorOfType(node, types, scopes, pointer = null, root = null) {
  //note: you may want to include "SourceUnit" as a fallback type when using
  //this function for convenience.
  //you only need to pass pointer and root if you want this function to work
  //from Yul.  Otherwise you can omit those and you'll get null if you happen
  //to be in Yul.
  while (node && !types.includes(node.nodeType)) {
    if (node.id !== undefined) {
      node = scopes[scopes[node.id].parentId].definition;
    } else {
      if (pointer === null || root === null) {
        return null;
      }
      pointer = pointer.replace(/\/[^/]*$/, ""); //chop off end
      node = jsonpointer.get(root, pointer);
    }
  }
  return node;
}

//given a modifier invocation (or inheritance specifier) node,
//get the node for the actual modifier (or constructor)
function modifierForInvocation(invocation, scopes) {
  let rawId; //raw referencedDeclaration ID extracted from the AST.
  //if it's a modifier this is what we want, but if it's base
  //constructor, we'll get the contract instead, and need to find its
  //constructor.
  switch (invocation.nodeType) {
    case "ModifierInvocation":
      rawId = invocation.modifierName.referencedDeclaration;
      break;
    case "InheritanceSpecifier":
      rawId = invocation.baseName.referencedDeclaration;
      break;
    default:
      debug("bad invocation node");
  }
  let rawNode = scopes[rawId].definition;
  switch (rawNode.nodeType) {
    case "ModifierDefinition":
      return rawNode;
    case "ContractDefinition":
      return rawNode.nodes.find(
        node =>
          node.nodeType === "FunctionDefinition" &&
          Codec.Ast.Utils.functionKind(node) === "constructor"
      );
    default:
      //we should never hit this case
      return undefined;
  }
}

//see data.views.contexts for an explanation
function debuggerContextToDecoderContext(context) {
  let {
    context: contextHash,
    contractName,
    binary,
    contractId,
    contractKind,
    isConstructor,
    abi,
    payable,
    compiler,
    compilationId
  } = context;
  return {
    context: contextHash,
    contractName,
    binary,
    contractId,
    contractKind,
    isConstructor,
    abi: Codec.AbiData.Utils.computeSelectors(abi),
    payable,
    compiler,
    compilationId
  };
}

//spoofed definitions we'll need
//we'll give them id -1 to indicate that they're spoofed

export const NOW_DEFINITION = {
  id: -1,
  src: "0:0:-1",
  name: "now",
  nodeType: "VariableDeclaration",
  typeDescriptions: {
    typeIdentifier: "t_uint256",
    typeString: "uint256"
  }
};

export const MSG_DEFINITION = {
  id: -1,
  src: "0:0:-1",
  name: "msg",
  nodeType: "VariableDeclaration",
  typeDescriptions: {
    typeIdentifier: "t_magic_message",
    typeString: "msg"
  }
};

export const TX_DEFINITION = {
  id: -1,
  src: "0:0:-1",
  name: "tx",
  nodeType: "VariableDeclaration",
  typeDescriptions: {
    typeIdentifier: "t_magic_transaction",
    typeString: "tx"
  }
};

export const BLOCK_DEFINITION = {
  id: -1,
  src: "0:0:-1",
  name: "block",
  nodeType: "VariableDeclaration",
  typeDescriptions: {
    typeIdentifier: "t_magic_block",
    typeString: "block"
  }
};

function spoofThisDefinition(contractName, contractId, contractKind) {
  let formattedName = contractName.replace(/\$/g, "$$".repeat(3));
  //note that string.replace treats $'s specially in the replacement string;
  //we want 3 $'s for each $ in the input, so we need to put *6* $'s in the
  //replacement string
  return {
    id: -1,
    src: "0:0:-1",
    name: "this",
    nodeType: "VariableDeclaration",
    typeDescriptions: {
      typeIdentifier: "t_contract$_" + formattedName + "_$" + contractId,
      typeString: contractKind + " " + contractName
    }
  };
}

const data = createSelectorTree({
  state: state => state.data,

  /**
   * data.views
   */
  views: {
    /*
     * data.views.atLastInstructionForSourceRange
     */
    atLastInstructionForSourceRange: createLeaf(
      [solidity.current.isSourceRangeFinal],
      final => final
    ),

    /**
     * data.views.scopes (namespace)
     */
    scopes: {
      /**
       * data.view.scopes (selector)
       * the raw version is below; this version accounts for inheritance
       * NOTE: grouped by compilation
       */
      _: createLeaf(["./raw", "./inlined/raw"], (scopes, inlined) =>
        Object.assign(
          {},
          ...Object.entries(scopes).map(([compilationId, nodes]) => ({
            [compilationId]: Object.assign(
              {},
              ...Object.entries(nodes).map(([id, scope]) => {
                let definition = inlined[compilationId][id].definition;
                if (definition.nodeType !== "ContractDefinition") {
                  return { [id]: scope };
                }
                //if we've reached this point, we should be dealing with a
                //contract, and specifically a contract -- not an interface or
                //library (those don't get "variables" entries in their scopes)
                debug("contract id %d", id);
                let newScope = { ...scope };
                //note that Solidity gives us the linearization in order from most
                //derived to most base, but we want most base to most derived;
                //annoyingly, reverse() is in-place, so we clone with slice() first
                let linearizedBaseContractsFromBase = definition.linearizedBaseContracts
                  .slice()
                  .reverse();
                linearizedBaseContractsFromBase.pop(); //remove the last element, i.e.,
                //the contract itself, because we want to treat that one specially
                //now, we put it all together
                newScope.variables = []
                  .concat(
                    //concatenate the variables lists from the base classes
                    ...linearizedBaseContractsFromBase.map(
                      contractId =>
                        scopes[compilationId][contractId].variables || []
                      //we need the || [] because contracts with no state variables
                      //have variables undefined rather than empty like you'd expect
                    )
                  )
                  .filter(
                    variable =>
                      inlined[compilationId][variable.astRef].definition
                        .visibility !== "private"
                    //filter out private variables from the base classes
                  )
                  //add in the variables for the contract itself -- note that here
                  //private variables are not filtered out!
                  .concat(scopes[compilationId][id].variables || [])
                  .filter(variable => {
                    //HACK: let's filter out those constants we don't know
                    //how to read.  they'll just clutter things up.
                    debug("variable %O", variable);
                    let definition =
                      inlined[compilationId][variable.astRef].definition;
                    return (
                      !definition.constant ||
                      Codec.Ast.Utils.isSimpleConstant(definition.value)
                    );
                  });

                return { [id]: newScope };
              })
            )
          }))
        )
      ),

      /*
       * data.views.scopes.raw
       * NOTE: grouped by compilation
       *
       * the raw scopes data, just with intermediate
       * layers cut out
       */
      raw: createLeaf(["/info/scopes"], scopes =>
        Object.assign(
          {},
          ...Object.entries(scopes.byCompilationId).map(
            ([compilationId, { byAstRef: nodes }]) => ({
              [compilationId]: { ...nodes }
            })
          )
        )
      ),

      /**
       * data.views.scopes.inlined (namespace)
       */
      inlined: {
        /**
         * data.views.scopes.inlined (selector)
         * see data.views.scopes for how this differs from the raw version
         * NOTE: grouped by compilation
         */
        _: createLeaf(["../_", "./raw"], (scopes, inlined) =>
          Object.assign(
            {},
            ...Object.entries(inlined).map(([compilationId, nodes]) => ({
              [compilationId]: Object.assign(
                {},
                ...Object.entries(nodes).map(([id, info]) => ({
                  [id]: {
                    ...info,
                    variables: scopes[compilationId][id].variables
                  }
                }))
              )
            }))
          )
        ),

        /**
         * data.views.scopes.inlined.raw
         * NOTE: grouped by compilation
         */
        raw: createLeaf(
          ["../raw", solidity.info.sources],

          (scopes, sources) =>
            Object.assign(
              {},
              ...Object.entries(scopes).map(([compilationId, nodes]) => ({
                [compilationId]: Object.assign(
                  {},
                  ...Object.entries(nodes).map(([id, entry]) => ({
                    [id]: {
                      ...entry,

                      definition: jsonpointer.get(
                        sources[compilationId].byId[entry.sourceId].ast,
                        entry.pointer
                      )
                    }
                  }))
                )
              }))
            )
        )
      }
    },

    /*
     * data.views.userDefinedTypes
     * user-defined types for passing to the decoder
     * NOTE: *not* grouped by compilation
     */
    userDefinedTypes: createLeaf(
      ["./referenceDeclarations", "./scopes", solidity.info.sources],
      (referenceDeclarations, scopes, sources) => {
        return Object.assign(
          {},
          ...flatten(
            Object.entries(referenceDeclarations).map(
              ([compilationId, nodes]) =>
                Object.values(nodes)
                  .map(node =>
                    Codec.Ast.Import.definitionToStoredType(
                      node,
                      compilationId,
                      sources[compilationId].byId[
                        scopes[compilationId][node.id].sourceId
                      ].compiler,
                      referenceDeclarations[compilationId]
                    )
                  )
                  .map(type => ({ [type.id]: type }))
            )
          )
        );
      }
    ),

    /*
     * data.views.contractAllocationInfo
     */
    contractAllocationInfo: createLeaf(
      [
        "/info/userDefinedTypes",
        "/views/scopes/inlined",
        solidity.info.sources,
        evm.info.contexts
      ],
      (userDefinedTypes, scopes, sources, contexts) =>
        Object.values(userDefinedTypes)
          .filter(
            ({ compilationId, id }) =>
              scopes[compilationId][id].definition.nodeType ===
              "ContractDefinition"
          )
          .map(({ compilationId, id }) => {
            debug("id: %O", id);
            debug("compilationId: %O", compilationId);
            let deployedContext = Object.values(contexts).find(
              context =>
                !context.isConstructor &&
                context.compilationId === compilationId &&
                context.contractId === id
            );
            let constructorContext = Object.values(contexts).find(
              context =>
                context.isConstructor &&
                context.compilationId === compilationId &&
                context.contractId === id
            );
            let immutableReferences = deployedContext
              ? deployedContext.immutableReferences
              : undefined;
            return {
              contractNode: scopes[compilationId][id].definition,
              compilationId,
              immutableReferences,
              //we don't just use deployedContext to get compiler because it might not exist!
              compiler:
                sources[compilationId].byId[scopes[compilationId][id].sourceId]
                  .compiler,
              //the following three are only needed for decoding return values
              abi: (deployedContext || {}).abi,
              deployedContext,
              constructorContext
            };
          })
    ),

    /*
     * data.views.referenceDeclarations
     * NOTE: grouped by compilation
     */
    referenceDeclarations: createLeaf(
      ["./scopes/inlined", "/info/userDefinedTypes"],
      (scopes, userDefinedTypes) =>
        Object.assign(
          {},
          ...Object.entries(scopes).map(([compilationId, nodes]) => ({
            [compilationId]: Object.assign(
              {},
              ...userDefinedTypes.map(
                ({ compilationId: compilationIdForType, id }) =>
                  compilationIdForType === compilationId
                    ? { [id]: nodes[id].definition }
                    : {}
              )
            )
          }))
        )
    ),

    /**
     * data.views.mappingKeys
     */
    mappingKeys: createLeaf(
      ["/proc/mappedPaths", "/current/address"],
      (mappedPaths, address) =>
        []
          .concat(
            ...Object.values(
              (mappedPaths.byAddress[address] || { byType: {} }).byType
            ).map(({ bySlotAddress }) => Object.values(bySlotAddress))
          )
          .filter(slot => slot.key !== undefined)
    ),

    /*
     * data.views.blockNumber
     * returns block number as string
     */
    blockNumber: createLeaf([evm.transaction.globals.block], block =>
      block.number.toString()
    ),

    /*
     * data.views.instances
     * same as evm.current.codex.instances, but we just map address => binary,
     * we don't bother with context, and also the code is a Uint8Array
     */
    instances: createLeaf([evm.current.codex.instances], instances =>
      Object.assign(
        {},
        ...Object.entries(instances).map(([address, { binary }]) => ({
          [address]: Codec.Conversion.toBytes(binary)
        }))
      )
    ),

    /*
     * data.views.contexts
     * same as evm.info.contexts, but:
     * 0. we only include non-constructor contexts
     * 1. we strip out sourceMap and primarySource
     * 2. we alter abi in two ways:
     * 2a. we strip out everything but functions
     * 2b. abi is now an object, not an array, and indexed by these signatures
     */
    contexts: createLeaf([evm.info.contexts], contexts =>
      Object.assign(
        {},
        ...Object.values(contexts)
          .filter(context => !context.isConstructor)
          .map(context => ({
            [context.contractId]: debuggerContextToDecoderContext(context)
          }))
      )
    )
  },

  /**
   * data.info
   */
  info: {
    /**
     * data.info.scopes
     */
    scopes: createLeaf(["/state"], state => state.info.scopes),

    /*
     * data.info.allocations
     */
    allocations: {
      /*
       * data.info.allocations.storage
       */
      storage: createLeaf(["/state"], state => state.info.allocations.storage),

      /**
       * data.info.allocations.state
       */
      state: createLeaf(["/state"], state => state.info.allocations.state),

      /*
       * data.info.allocations.memory
       */
      memory: createLeaf(["/state"], state => state.info.allocations.memory),

      /*
       * data.info.allocations.abi
       */
      abi: createLeaf(["/state"], state => state.info.allocations.abi),

      /*
       * data.info.allocations.calldata
       */
      calldata: createLeaf(["/state"], state => state.info.allocations.calldata)
    },

    /**
     * data.info.userDefinedTypes
     */
    userDefinedTypes: createLeaf(
      ["/state"],
      state => state.info.userDefinedTypes
    )
  },

  /**
   * data.proc
   */
  proc: {
    /**
     * data.proc.assignments
     */
    assignments: createLeaf(
      ["/state"],
      state => state.proc.assignments
      //note: this no longer fetches just the byId, but rather the whole
      //assignments object
    ),

    /*
     * data.proc.mappedPaths
     */
    mappedPaths: createLeaf(["/state"], state => state.proc.mappedPaths),

    /**
     * data.proc.decodingKeys
     *
     * number of keys that are still decoding
     */
    decodingKeys: createLeaf(
      ["./mappedPaths"],
      mappedPaths => mappedPaths.decodingStarted
    )
  },

  /**
   * data.current
   */
  current: {
    /**
     * data.current.state
     */
    state: {
      /**
       * data.current.state.stack
       */
      stack: createLeaf(
        [evm.current.state.stack],

        words => (words || []).map(word => Codec.Conversion.toBytes(word))
      ),

      /**
       * data.current.state.memory
       */
      memory: createLeaf(
        [evm.current.state.memory],

        words => Codec.Conversion.toBytes(words.join(""))
      ),

      /**
       * data.current.state.code
       */
      code: createLeaf([evm.current.context], ({ binary }) =>
        Codec.Conversion.toBytes(binary)
      ),

      /**
       * data.current.state.calldata
       */
      calldata: createLeaf(
        [evm.current.call],

        ({ data }) => Codec.Conversion.toBytes(data)
      ),

      /**
       * data.current.state.storage
       */
      storage: createLeaf(
        [evm.current.codex.storage],

        mapping =>
          Object.assign(
            {},
            ...Object.entries(mapping).map(([address, word]) => ({
              [`0x${address}`]: Codec.Conversion.toBytes(word)
            }))
          )
      ),

      /*
       * data.current.state.specials
       * I've named these after the solidity variables they correspond to,
       * which are *mostly* the same as the corresponding EVM opcodes
       * (FWIW: this = ADDRESS, sender = CALLER, value = CALLVALUE)
       */
      specials: createLeaf(
        ["/current/address", evm.current.call, evm.transaction.globals],
        (address, { sender, value }, { tx, block }) => ({
          this: Codec.Conversion.toBytes(address),

          sender: Codec.Conversion.toBytes(sender),

          value: Codec.Conversion.toBytes(value),

          //let's crack open that tx and block!
          ...Object.assign(
            {},
            ...Object.entries(tx).map(([variable, value]) => ({
              [variable]: Codec.Conversion.toBytes(value)
            }))
          ),

          ...Object.assign(
            {},
            ...Object.entries(block).map(([variable, value]) => ({
              [variable]: Codec.Conversion.toBytes(value)
            }))
          )
        })
      )
    },

    /**
     * data.current.compilationId
     */
    compilationId: createLeaf(
      [evm.current.context],
      ({ compilationId }) => compilationId
    ),

    /**
     * data.current.sourceId
     */
    sourceId: createLeaf([solidity.current.source], ({ id }) => id),

    /**
     * data.current.root
     */
    root: createLeaf([solidity.current.source], ({ ast }) => ast),

    /**
     * data.current.scopes (namespace)
     */
    scopes: {
      /**
       * data.current.scopes (selector)
       * Replacement for the old data.info.scopes;
       * that one now contains multi-compilation info, this
       * one contains only the current compilation
       */
      _: createLeaf(
        ["/views/scopes", "../compilationId"],
        (scopes, compilationId) => scopes[compilationId]
      ),

      /**
       * data.current.scopes.inlined
       * Replacement for the old data.views.scopes.inlined;
       * that one now contains multi-compilation info, this
       * one contains only the current compilation
       */
      inlined: createLeaf(
        ["/views/scopes/inlined", "../compilationId"],
        (scopes, compilationId) => scopes[compilationId]
      )
    },

    /*
     * data.current.referenceDeclarations
     */
    referenceDeclarations: createLeaf(
      ["/views/referenceDeclarations", "./compilationId"],
      (scopes, compilationId) => scopes[compilationId]
    ),

    /*
     * data.current.allocations
     */
    allocations: {
      /*
       * data.current.allocations.state
       * Same as data.info.allocations.state, but uses the old allocation
       * format (more convenient for debugger) where members are stored by ID
       * in an object instead of by index in an array; also only holds things
       * from the current compilation
       * ALSO: if we're in a constructor, replaces all code pointers by appropriate
       * memory pointers :)
       */
      state: createLeaf(
        [
          "/info/allocations/state",
          "/views/userDefinedTypes",
          "../compilationId",
          evm.current.context
        ],
        (
          allAllocations,
          userDefinedTypes,
          compilationId,
          { isConstructor }
        ) => {
          const allocations = compilationId
            ? allAllocations[compilationId]
            : {};
          //several-deep clone
          let transformedAllocations = Object.assign(
            {},
            ...Object.entries(allocations).map(([id, allocation]) => ({
              [id]: {
                members: allocation.members.map(member => ({ ...member }))
              }
            }))
          );
          //if we're not in a constructor, we don't need to actually transform it.
          //if we are...
          if (isConstructor) {
            //...we must transform code pointers!
            for (const id in transformedAllocations) {
              const allocation = transformedAllocations[id];
              //here, the magic number 4 is the number of reserved memory slots
              //at the start of memory.  immutables go immediately afterward.
              let start = 4 * Codec.Evm.Utils.WORD_SIZE;
              for (const member of allocation.members) {
                //if it's not a code pointer, leave it alone
                if (
                  member.pointer.location === "code" ||
                  member.pointer.location === "nowhere"
                ) {
                  //if it is, transform it
                  member.pointer = {
                    location: "memory",
                    start,
                    length: Codec.Evm.Utils.WORD_SIZE
                  };
                  start += Codec.Evm.Utils.WORD_SIZE;
                }
              }
            }
          }
          //having now transformed code pointers if needed,
          //we now index by ID
          return Object.assign(
            {},
            ...Object.entries(transformedAllocations).map(
              ([id, allocation]) => ({
                [id]: {
                  members: Object.assign(
                    {},
                    ...allocation.members.map(memberAllocation => ({
                      [memberAllocation.definition.id]: memberAllocation
                    }))
                  )
                }
              })
            )
          );
        }
      )
    },

    /**
     * data.current.compiler
     */
    compiler: createLeaf([evm.current.context], ({ compiler }) => compiler),

    /**
     * data.current.bareLetsInYulAreHit
     */
    bareLetsInYulAreHit: createLeaf(
      ["./compiler"],
      compiler =>
        compiler !== undefined && //if no compiler we'll assume the old way I guess??
        semver.satisfies(compiler.version, ">=0.6.8", {
          includePrerelease: true
        })
    ),

    /**
     * data.current.node
     */
    node: createLeaf([solidity.current.node], identity),

    /**
     * data.current.pointer
     */
    pointer: createLeaf([solidity.current.pointer], identity),

    /**
     * data.current.scope
     * old alias for data.current.node (deprecated)
     */
    scope: createLeaf(["./node"], identity),

    /*
     * data.current.contract
     * warning: may return null or similar, even though SourceUnit is included
     * as fallback
     */
    contract: createLeaf(
      ["./node", "./scopes/inlined", "./pointer", "./root"],
      (node, scopes, pointer, root) => {
        const types = ["ContractDefinition", "SourceUnit"];
        //SourceUnit included as fallback
        return findAncestorOfType(node, types, scopes, pointer, root);
      }
    ),

    /*
     * data.current.function
     * may be modifier rather than function!
     */
    function: createLeaf(
      ["./node", "./scopes/inlined", "./pointer", "./root"],
      (node, scopes, pointer, root) => {
        const types = [
          "FunctionDefinition",
          "ModifierDefinition",
          "ContractDefinition",
          "SourceUnit"
        ];
        //SourceUnit included as fallback
        return findAncestorOfType(node, types, scopes, pointer, root);
      }
    ),

    /*
     * data.current.inModifier
     */
    inModifier: createLeaf(
      ["./function"],
      node => node && node.nodeType === "ModifierDefinition"
    ),

    /*
     * data.current.inFunctionOrModifier
     */
    inFunctionOrModifier: createLeaf(
      ["./function"],
      node =>
        node &&
        (node.nodeType === "FunctionDefinition" ||
          node.nodeType === "ModifierDefinition")
    ),

    /**
     * data.current.functionDepth
     */

    functionDepth: createLeaf([solidity.current.functionDepth], identity),

    /**
     * data.current.modifierDepth
     */

    modifierDepth: createLeaf([solidity.current.modifierDepth], identity),

    /**
     * data.current.address
     * NOTE: this is the STORAGE address for the current call, not the CODE
     * address
     */

    address: createLeaf([evm.current.call], call => call.storageAddress),

    /**
     * data.current.functionsByProgramCounter
     */
    functionsByProgramCounter: createLeaf(
      [solidity.current.functionsByProgramCounter],
      functions => functions
    ),

    /**
     * data.current.context
     */
    context: createLeaf([evm.current.context], debuggerContextToDecoderContext),

    /*
     * data.current.aboutToModify
     * HACK
     * This selector is used to catch those times when we go straight from a
     * modifier invocation into the modifier itself, skipping over the
     * definition node (this includes base constructor calls).  So it should
     * return true when:
     * 1. we're on the node corresponding to an argument to a modifier
     * invocation or base constructor call, or, if said argument is a type
     * conversion, its argument (or nested argument)
     * 2. the next node is not a FunctionDefinition, ModifierDefinition, or
     * in the same modifier / base constructor invocation
     */
    aboutToModify: createLeaf(
      [
        "./node",
        "./modifierInvocation",
        "./modifierArgumentIndex",
        "/next/node",
        "/next/modifierInvocation",
        evm.current.step.isContextChange
      ],
      (node, invocation, index, next, nextInvocation, isContextChange) => {
        //ensure: current instruction is not a context change (because if it is
        //we cannot rely on the data.next selectors, but also if it is we know
        //we're not about to call a modifier or base constructor!)
        //we also want to return false if we can't find things for whatever
        //reason
        if (
          isContextChange ||
          !node ||
          node.id === undefined ||
          !next ||
          next.id === undefined ||
          !invocation ||
          invocation.id === undefined ||
          !nextInvocation ||
          nextInvocation.id === undefined
        ) {
          return false;
        }

        //ensure: current position is in a ModifierInvocation or
        //InheritanceSpecifier (recall that SourceUnit was included as
        //fallback)
        if (invocation.nodeType === "SourceUnit") {
          return false;
        }

        //ensure: next node is not a function definition or modifier definition
        if (
          next.nodeType === "FunctionDefinition" ||
          next.nodeType === "ModifierDefinition"
        ) {
          return false;
        }

        //ensure: next node is not in the same invocation
        if (
          nextInvocation.nodeType !== "SourceUnit" &&
          nextInvocation.id === invocation.id
        ) {
          return false;
        }

        //now: are we on the node corresponding to an argument, or, if
        //it's a type conversion, its nested argument?
        if (index === undefined) {
          return false;
        }
        let argument = invocation.arguments[index];
        while (argument.kind === "typeConversion") {
          if (node.id === argument.id) {
            return true;
          }
          argument = argument.arguments[0];
        }
        return node.id === argument.id;
      }
    ),

    /*
     * data.current.modifierInvocation
     */
    modifierInvocation: createLeaf(
      ["./node", "./scopes/inlined"],
      (node, scopes) => {
        const types = [
          "ModifierInvocation",
          "InheritanceSpecifier",
          "SourceUnit"
        ];
        //again, SourceUnit included as fallback
        return findAncestorOfType(node, types, scopes);
      }
    ),

    /**
     * data.current.modifierArgumentIndex
     * gets the index of the current modifier argument that you're in
     * (undefined when not in a modifier argument)
     */
    modifierArgumentIndex: createLeaf(
      ["./scopes", "./node", "./modifierInvocation"],
      (scopes, node, invocation) => {
        if (!invocation || invocation.nodeType === "SourceUnit") {
          return undefined;
        }

        let pointer = scopes[node.id].pointer;
        let invocationPointer = scopes[invocation.id].pointer;

        //slice the invocation pointer off the beginning
        let difference = pointer.slice(invocationPointer.length);
        debug("difference %s", difference);
        let rawIndex = difference.match(/^\/arguments\/(\d+)/);
        //note that that \d+ is greedy
        debug("rawIndex %o", rawIndex);
        if (rawIndex === null) {
          return undefined;
        }
        return parseInt(rawIndex[1]);
      }
    ),

    /*
     * data.current.modifierBeingInvoked
     * gets the node corresponding to the modifier or base constructor
     * being invoked
     */
    modifierBeingInvoked: createLeaf(
      ["./modifierInvocation", "./scopes/inlined"],
      (invocation, scopes) => {
        if (!invocation || invocation.nodeType === "SourceUnit") {
          return undefined;
        }

        return modifierForInvocation(invocation, scopes);
      }
    ),

    /**
     * data.current.identifiers (namespace)
     */
    identifiers: {
      /**
       * data.current.identifiers (selector)
       *
       * returns identifers and corresponding definition node ID or builtin name
       * (object entries look like [name]: {astRef: astRef}, [name]: {builtin: name})
       */
      _: createLeaf(
        [
          "/current/scopes/inlined",
          "/current/node",
          "/current/pointer",
          "/current/sourceId"
        ],

        (scopes, scope, pointer, sourceId) => {
          let variables = {};
          if (scope !== undefined) {
            let cur =
              scope.id !== undefined ? scope.id : makePath(sourceId, pointer);

            while (cur !== null && scopes[cur]) {
              variables = Object.assign(
                variables,
                ...(scopes[cur].variables || [])
                  .filter(variable => variable.name !== "") //exclude anonymous output params
                  .filter(variable => variables[variable.name] == undefined) //don't add shadowed vars
                  .map(variable => ({
                    [variable.name]: { astRef: variable.astRef }
                  }))
              );
              //NOTE: because these assignments are processed in order, that means
              //that if a base class and derived class have variables with the same
              //name, the derived version will be processed later and therefore overwrite --
              //which is exactly what we want, so yay

              if (scopes[cur].definition.nodeType === "YulFunctionDefinition") {
                //Yul functions make the outside invisible
                break;
              }

              if (scopes[cur].parentId !== undefined) {
                cur = scopes[cur].parentId; //may be null!
                //(undefined means we don't know what's up,
                //null means there's nothing)
              } else {
                //in this case, cur must be a source-and-pointer, so we'll step
                //up that way (skipping over any arrays)
                cur = cur.replace(/\/[^/]*(\/\d+)?$/, "");
              }
            }
          }

          let builtins = {
            msg: { builtin: "msg" },
            tx: { builtin: "tx" },
            block: { builtin: "block" },
            this: { builtin: "this" },
            now: { builtin: "now" }
          };

          if (
            scope &&
            (scope.nodeType.startsWith("Yul") ||
              scope.nodeType === "InlineAssembly")
          ) {
            //builtins aren't visible in Yul
            return variables;
          }

          return { ...variables, ...builtins };
        }
      ),

      /**
       * data.current.identifiers.definitions (namespace)
       */
      definitions: {
        /* data.current.identifiers.definitions (selector)
         * definitions for current variables, by identifier
         */
        _: createLeaf(
          ["/current/scopes/inlined", "../_", "./this"],

          (scopes, identifiers, thisDefinition) => {
            let variables = Object.assign(
              {},
              ...Object.entries(identifiers).map(([identifier, variable]) => {
                if (variable.astRef !== undefined) {
                  let { definition } = scopes[variable.astRef];
                  return { [identifier]: definition };
                  //there used to be separate code for Yul variables here,
                  //but now that's handled in definitionToType
                } else {
                  return {}; //skip over builtins; we'll handle those separately
                }
              })
            );
            let builtins = {
              msg: MSG_DEFINITION,
              tx: TX_DEFINITION,
              block: BLOCK_DEFINITION,
              now: NOW_DEFINITION
            };
            //only include this when it has a proper definition
            if (thisDefinition) {
              builtins.this = thisDefinition;
            }
            return { ...variables, ...builtins };
          }
        ),

        /*
         * data.current.identifiers.definitions.this
         *
         * returns a spoofed definition for the this variable
         */
        this: createLeaf(
          ["/current/contract"],
          contractNode =>
            contractNode && contractNode.nodeType === "ContractDefinition"
              ? spoofThisDefinition(
                  contractNode.name,
                  contractNode.id,
                  contractNode.contractKind
                )
              : null
        )
      },

      /**
       * data.current.identifiers.refs
       *
       * current variables' value refs
       */
      refs: createLeaf(
        [
          "/proc/assignments",
          "./_",
          "/current/compilationId",
          "/current/functionDepth", //for pruning things too deep on stack
          "/current/modifierDepth", //when it's useful
          "/current/inModifier",
          "/current/address" //for contract variables
        ],

        (
          assignments,
          identifiers,
          compilationId,
          currentDepth,
          modifierDepth,
          inModifier,
          address
        ) =>
          Object.assign(
            {},
            ...Object.entries(identifiers).map(
              ([identifier, { astRef, builtin }]) => {
                let id;
                debug("astRef: %o", astRef);
                debug("builtin: %s", builtin);

                //is this an ordinary variable or a builtin?
                if (astRef !== undefined) {
                  //if not a builtin, first check if it's a contract var
                  let compilationAssignments =
                    (assignments.byCompilationId[compilationId] || {})
                      .byAstRef || {};
                  id = (compilationAssignments[astRef] || []).find(
                    idHash => assignments.byId[idHash].address === address
                  );
                  debug("id after global: %s", id);

                  //if not contract, it's local, so identify by stackframe
                  if (id === undefined) {
                    //if we're in a modifier, include modifierDepth
                    if (inModifier) {
                      id = stableKeccak256({
                        astRef,
                        compilationId,
                        stackframe: currentDepth,
                        modifierDepth
                      });
                    } else {
                      id = stableKeccak256({
                        astRef,
                        compilationId,
                        stackframe: currentDepth
                      });
                    }
                  }
                  debug("id after local: %s", id);
                } else {
                  //otherwise, it's a builtin
                  //NOTE: for now we assume there is only one assignment per
                  //builtin, but this will change in the future
                  debug("builtin: %s", builtin);
                  id = assignments.byBuiltin[builtin][0];
                }

                //if we still didn't find it, oh well
                debug("id: %s", id);

                let { ref } = assignments.byId[id] || {};
                if (!ref) {
                  return undefined;
                }

                return {
                  [identifier]: ref
                };
              }
            )
          )
      )
    },

    /**
     * data.current.returnStatus
     */
    returnStatus: createLeaf(
      [evm.current.step.returnStatus],
      status => (status === null ? undefined : status) //convert null to undefined to be safe
    ),

    /**
     * data.current.returnAllocation
     */
    returnAllocation: createLeaf(
      [evm.current.call, "/current/context", "/info/allocations/calldata"],
      (
        { data: calldata },
        { context, isConstructor },
        { constructorAllocations, functionAllocations }
      ) => {
        if (isConstructor) {
          //we're in a constructor call
          let allocation = constructorAllocations[context];
          if (!allocation) {
            return null;
          }
          return allocation.output;
        } else {
          //usual case
          let selector = calldata.slice(0, 2 + 4 * 2); //extract first 4 bytes of hex string
          debug("selector: %s", selector);
          debug("bySelector: %o", functionAllocations[context]);
          let allocation = (functionAllocations[context] || {})[selector];
          if (!allocation) {
            return null;
          }
          return allocation.output;
        }
      }
    )
  },

  /**
   * data.next
   */
  next: {
    /**
     * data.next.state
     * Yes, I'm just repeating the code for data.current.state.stack here;
     * not worth the trouble to factor out
     */
    state: {
      /**
       * data.next.state.stack
       */
      stack: createLeaf(
        [evm.next.state.stack],

        words => (words || []).map(word => Codec.Conversion.toBytes(word))
      ),

      /**
       * data.next.state.returndata
       * NOTE: this is only for use by returnValue(); this is *not*
       * an accurate reflection of the current contents of returndata!
       * we don't track that at the moment
       */
      returndata: createLeaf([evm.current.step.returnValue], data =>
        Codec.Conversion.toBytes(data)
      )
    },

    //HACK WARNING
    //the following selectors depend on solidity.next
    //do not use them when the current instruction is a context change!

    /**
     * data.next.node
     */
    node: createLeaf([solidity.next.node], identity),

    /**
     * data.next.pointer
     */
    pointer: createLeaf([solidity.next.pointer], identity),

    /**
     * data.next.modifierInvocation
     * Note: yes, I'm just repeating the code from data.current here but with
     * invalid added
     */
    modifierInvocation: createLeaf(
      ["./node", "/current/scopes/inlined", evm.current.step.isContextChange],
      (node, scopes, invalid) => {
        //don't attempt this at a context change!
        //(also don't attempt this if we can't find the node for whatever
        //reason)
        if (invalid) {
          return undefined;
        }
        const types = [
          "ModifierInvocation",
          "InheritanceSpecifier",
          "SourceUnit"
        ];
        //again, SourceUnit included as fallback
        return findAncestorOfType(node, types, scopes);
      }
    ),

    /*
     * data.next.modifierBeingInvoked
     */
    modifierBeingInvoked: createLeaf(
      [
        "./modifierInvocation",
        "/current/scopes/inlined",
        evm.current.step.isContextChange
      ],
      (invocation, scopes, invalid) => {
        if (invalid || !invocation || invocation.nodeType === "SourceUnit") {
          return undefined;
        }

        return modifierForInvocation(invocation, scopes);
      }
    )
    //END HACK WARNING
  },

  /**
   * data.nextMapped
   */
  nextMapped: {
    /**
     * data.nextMapped.state
     * Yes, I'm just repeating the code for data.current.state.stack here;
     * not worth the trouble to factor out
     * HACK: this assumes we're not about to change context! don't use this if we
     * are!
     */
    state: {
      /**
       * data.nextMapped.state.stack
       */
      stack: createLeaf(
        [solidity.current.nextMapped],

        step =>
          ((step || {}).stack || []).map(word => Codec.Conversion.toBytes(word))
      )
    }
  },

  /**
   * data.nextOfSameDepth
   */
  nextOfSameDepth: {
    /**
     * data.nextOfSameDepth.state
     * Yes, I'm just repeating the code for data.current.state.stack here but
     * with an extra guard... *still* not worth the trouble to factor out
     * HOWEVER, this one also returns null if there is no nextOfSameDepth
     */
    state: {
      /**
       * data.nextOfSameDepth.state.stack
       */
      stack: createLeaf(
        [trace.nextOfSameDepth],

        step =>
          step
            ? (step.stack || []).map(word => Codec.Conversion.toBytes(word))
            : null
      )
    }
  }
});

export default data;
