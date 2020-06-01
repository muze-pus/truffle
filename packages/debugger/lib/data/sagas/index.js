import debugModule from "debug";
const debug = debugModule("debugger:data:sagas");

import { put, takeEvery, select } from "redux-saga/effects";

import {
  prefixName,
  stableKeccak256,
  makeAssignment,
  makePath
} from "lib/helpers";

import { TICK } from "lib/trace/actions";
import * as actions from "../actions";
import * as trace from "lib/trace/sagas";
import * as evm from "lib/evm/sagas";
import * as web3 from "lib/web3/sagas";

import data from "../selectors";

import sum from "lodash.sum";
import jsonpointer from "json-pointer";

import * as Codec from "@truffle/codec";
import BN from "bn.js";

export function* scope(nodeId, pointer, parentId, sourceId, compilationId) {
  yield put(actions.scope(nodeId, pointer, parentId, sourceId, compilationId));
}

export function* declare(node, compilationId) {
  yield put(actions.declare(node.name, node.id, node.scope, compilationId));
}

export function* yulScope(pointer, sourceId, compilationId, parentId) {
  yield put(
    actions.scope(undefined, pointer, parentId, sourceId, compilationId)
  );
}

export function* yulDeclare(
  node,
  pointer,
  scopePointer,
  sourceId,
  compilationId
) {
  yield put(
    actions.declare(
      node.name,
      makePath(sourceId, pointer),
      makePath(sourceId, scopePointer),
      compilationId
    )
  );
}

export function* defineType(node, compilationId) {
  yield put(actions.defineType(node, compilationId));
}

function* tickSaga() {
  yield* variablesAndMappingsSaga();
  yield* trace.signalTickSagaCompletion();
}

export function* decode(definition, ref, compilationId) {
  const userDefinedTypes = yield select(data.views.userDefinedTypes);
  const state = yield select(data.current.state);
  const mappingKeys = yield select(data.views.mappingKeys);
  const allocations = yield select(data.info.allocations);
  const contexts = yield select(data.views.contexts);
  const currentContext = yield select(data.current.context);
  const internalFunctionsTable = yield select(
    data.current.functionsByProgramCounter
  );

  const ZERO_WORD = new Uint8Array(Codec.Evm.Utils.WORD_SIZE); //automatically filled with zeroes

  const decoder = Codec.decodeVariable(
    definition,
    ref,
    {
      userDefinedTypes,
      state,
      mappingKeys,
      allocations,
      contexts,
      currentContext,
      internalFunctionsTable
    },
    compilationId
  );

  debug("beginning decoding");
  let result = decoder.next();
  while (!result.done) {
    debug("request received");
    let request = result.value;
    let response;
    switch (request.type) {
      case "storage":
        //the debugger supplies all storage it knows at the beginning.
        //any storage it does not know is presumed to be zero.
        response = ZERO_WORD;
        break;
      case "code":
        response = yield* requestCode(request.address);
        break;
      default:
        debug("unrecognized request type!");
    }
    debug("sending response");
    result = decoder.next(response);
  }
  //at this point, result.value holds the final value
  debug("done decoding");
  debug("decoded value: %O", result.value);
  return result.value;
}

export function* decodeReturnValue() {
  const userDefinedTypes = yield select(data.views.userDefinedTypes);
  const state = yield select(data.next.state); //next state has the return data
  const allocations = yield select(data.info.allocations);
  const contexts = yield select(data.views.contexts);
  const status = yield select(data.current.returnStatus); //may be undefined
  const returnAllocation = yield select(data.current.returnAllocation); //may be null

  const decoder = Codec.decodeReturndata(
    {
      userDefinedTypes,
      state,
      allocations,
      contexts
    },
    returnAllocation,
    status
  );

  debug("beginning decoding");
  let result = decoder.next();
  while (!result.done) {
    debug("request received");
    let request = result.value;
    let response;
    switch (request.type) {
      //skip storage case, it won't happen here
      case "code":
        response = yield* requestCode(request.address);
        break;
      default:
        debug("unrecognized request type!");
    }
    debug("sending response");
    result = decoder.next(response);
  }
  //at this point, result.value holds the final value
  debug("done decoding");
  return result.value;
}

//NOTE: calling this *can* add a new instance, which will not
//go away on a reset!  Yes, this is a little weird, but we
//decided this is OK for now
function* requestCode(address) {
  const NO_CODE = new Uint8Array(); //empty array
  const blockNumber = yield select(data.views.blockNumber);
  const instances = yield select(data.views.instances);

  if (address in instances) {
    return instances[address];
  } else if (address === Codec.Evm.Utils.ZERO_ADDRESS) {
    //HACK: to avoid displaying the zero address to the user as an
    //affected address just because they decoded a contract or external
    //function variable that hadn't been initialized yet, we give the
    //zero address's codelessness its own private cache :P
    return NO_CODE;
  } else {
    //I don't want to write a new web3 saga, so let's just use
    //obtainBinaries with a one-element array
    debug("fetching binary");
    let binary = (yield* web3.obtainBinaries([address], blockNumber))[0];
    debug("adding instance");
    yield* evm.addInstance(address, binary);
    return Codec.Conversion.toBytes(binary);
  }
}

function* variablesAndMappingsSaga() {
  // stack is only ready for interpretation after the last step of each
  // source range
  //
  // the data module always looks at the result of a particular opcode
  // (i.e., the following trace step's stack/memory/storage), so this
  // asserts that the _current_ operation is the final one before
  // proceeding
  if (!(yield select(data.views.atLastInstructionForSourceRange))) {
    return;
  }

  let node = yield select(data.current.node);

  if (!node) {
    return;
  }

  //set up stack; see default case for what normally goes on
  let stack;
  switch (node.nodeType) {
    case "IndexAccess":
    case "MemberAccess":
      stack = yield select(data.nextMapped.state.stack);
      //HACK: unfortunately, in some cases, data.next.state.stack gets the wrong
      //results due to unmapped instructions intervening.  So, we get the stack at
      //the next *mapped* stack instead.  This is something of a hack and won't
      //work if we're about to change context, but it should work in the cases that
      //need it.
      break;
    case "YulFunctionCall":
      stack = yield select(data.nextOfSameDepth.state.stack);
      //if the step we're on is a CALL (or similar), as can happen with Yul,
      //we don't want to look at the stack on the *next* step, but rather
      //the step when it returns; hence this
      break;
    default:
      stack = yield select(data.next.state.stack); //note the use of next!
      //in this saga we are interested in the *results* of the current instruction
      //note that the decoder is still based on data.current.state; that's fine
      //though.  There's already a delay between when we record things off the
      //stack and when we decode them, after all.  Basically, nothing serious
      //should happen after an index node but before the index access node that
      //would cause storage, memory, or calldata to change, meaning that even if
      //the literal we recorded was a pointer, it will still be valid at the time
      //we use it.  (The other literals we make use of, for the base expressions,
      //are not decoded, so no potential mismatch there would be relevant anyway.)
      break;
  }

  if (!stack) {
    //note: should only happen in YulFunctionCall case
    return;
  }

  let top = stack.length - 1;

  //set up other variables
  let pointer = yield select(data.current.pointer);
  let nextPointer = yield select(data.next.pointer);
  let scopes = yield select(data.current.scopes.inlined);
  let allocations = yield select(data.current.allocations.state);
  let storageAllocations = yield select(data.info.allocations.storage);
  let userDefinedTypes = yield select(data.views.userDefinedTypes);
  let currentAssignments = yield select(data.proc.assignments);
  let mappedPaths = yield select(data.proc.mappedPaths);
  let currentDepth = yield select(data.current.functionDepth);
  let modifierDepth = yield select(data.current.modifierDepth);
  let inModifier = yield select(data.current.inModifier);
  let inFunctionOrModifier = yield select(data.current.inFunctionOrModifier);
  let address = yield select(data.current.address); //storage address, not code address
  let compilationId = yield select(data.current.compilationId);
  let sourceId = yield select(data.current.sourceId);
  let compiler = yield select(data.current.compiler);

  let assignment,
    assignments,
    preambleAssignments,
    baseExpression,
    slot,
    path,
    position;

  //HACK: modifier preamble
  //modifier definitions are typically skipped (this includes constructor
  //definitions when called as a base constructor); as such I've added this
  //"modifier preamble" to catch them
  if (yield select(data.current.aboutToModify)) {
    let modifier = yield select(data.current.modifierBeingInvoked);
    //may be either a modifier or base constructor
    let currentIndex = yield select(data.current.modifierArgumentIndex);
    debug("currentIndex %d", currentIndex);
    let parameters = modifier.parameters.parameters;
    //now: look at the parameters *after* the current index.  we'll need to
    //adjust for those.
    let parametersLeft = parameters.slice(currentIndex + 1);
    let adjustment = sum(parametersLeft.map(Codec.Ast.Utils.stackSize));
    debug("adjustment %d", adjustment);
    preambleAssignments = assignParameters(
      compilationId,
      parameters,
      top + adjustment,
      currentDepth,
      modifierDepth,
      modifier.nodeType === "ModifierDefinition"
    );
  } else {
    preambleAssignments = {};
  }

  switch (node.nodeType) {
    case "FunctionDefinition":
    case "ModifierDefinition":
      //NOTE: this will *not* catch most modifier definitions!
      //the rest hopefully will be caught by the modifier preamble
      //(in fact they won't all be, but...)

      //HACK: filter out some garbage
      //this filters out the case where we're really in an invocation of a
      //modifier or base constructor, but have temporarily hit the definition
      //node for some reason.  However this obviously can have a false positive
      //in the case where a function has the same modifier twice.
      let nextModifier = yield select(data.next.modifierBeingInvoked);
      if (nextModifier && nextModifier.id === node.id) {
        break;
      }

      let parameters = node.parameters.parameters;
      //note that we do *not* include return parameters, since those are
      //handled by the VariableDeclaration case (no, I don't know why it
      //works out that way)

      //we can skip preambleAssignments here, that isn't used in this case
      assignments = assignParameters(
        compilationId,
        parameters,
        top,
        currentDepth,
        modifierDepth,
        inModifier
      );

      debug("Function definition case");
      debug("assignments %O", assignments);

      yield put(actions.assign(assignments));
      break;

    case "YulFunctionDefinition":
      if (nextPointer === null || !nextPointer.startsWith(`${pointer}/body/`)) {
        //in this case, we're seeing the function
        //as it's being defined, rather than as it's
        //being called
        //notice the final slash; when you enter a function, you go *strictly inside*
        //its body (if you hit the body node itself you are seeing the definition)
        break;
      }
      //yul parameters are a bit weird.
      //whereas solidity parameters go bottom to top,
      //first inputs then outputs (and we skip handling the outputs),
      //yul parameters have the inputs go top to bottom,
      //and the outputs go bottom to top (again with the outputs on top)
      //note we need to handle both inputs and outputs here
      const returnSuffixes = (node.returnVariables || []).map(
        (_, index, vars) => `/returnVariables/${vars.length - 1 - index}`
      );
      const parameterSuffixes = (node.parameters || []).map(
        (_, index) => `/parameters/${index}`
      );
      //HACK: prior to 0.6.8, we *also* need to account for any bare lets (ones
      //w/no value given) at the beginning of the function body because these
      //will throw off our count otherwise
      let bareLetSuffixes = []; //when hack is not invoked, we just leave this empty
      if (!(yield select(data.current.bareLetsInYulAreHit))) {
        let outerIndex = 0;
        for (const declaration of node.body.statements) {
          if (
            declaration.nodeType !== "YulVariableDeclaration" ||
            declaration.value != null
          ) {
            //deliberate != for future Solidity versions
            break;
          }
          for (
            let innerIndex = 0;
            innerIndex < declaration.variables.length;
            innerIndex++
          ) {
            //we want to process from top to bottom, so we'll put the earlier
            //variables last
            bareLetSuffixes.unshift(
              `/body/statements/${outerIndex}/variables/${innerIndex}`
            );
          }
          outerIndex++;
        }
      }
      //both outputs and inputs in the appropriate order (top to bottom)
      //(well, and those lets...)
      const suffixes = bareLetSuffixes.concat(
        returnSuffixes,
        parameterSuffixes
      );
      debug("suffixes: %O", suffixes);
      assignments = {};
      position = top; //because that's how we'll process things
      for (const suffix of suffixes) {
        //we only care about the pointer, not the variable
        const sourceAndPointer = makePath(sourceId, pointer + suffix);
        assignment = makeAssignment(
          inModifier
            ? {
                compilationId,
                astRef: sourceAndPointer,
                stackframe: currentDepth,
                modifierDepth
              }
            : {
                compilationId,
                astRef: sourceAndPointer,
                stackframe: currentDepth
              },
          {
            location: "stack",
            from: position, //all Yul variables are size 1
            to: position
          }
        );
        assignments[assignment.id] = assignment;
        position--;
      }
      yield put(actions.assign(assignments));
      break;

    case "ContractDefinition":
      let allocation = allocations[node.id];

      debug("Contract definition case");
      debug("allocations %O", allocations);
      debug("allocation %O", allocation);
      assignments = {};
      for (let id in allocation.members) {
        id = Number(id); //not sure why we're getting them as strings, but...
        let idObj = { compilationId, astRef: id, address };
        let fullId = stableKeccak256(idObj);
        //we don't use makeAssignment here as we had to compute the ID anyway
        assignment = {
          ...idObj,
          id: fullId,
          ref: {
            ...((currentAssignments.byId[fullId] || {}).ref || {}),
            ...allocation.members[id].pointer
          }
        };
        assignments[fullId] = assignment;
      }
      debug("assignments %O", assignments);

      //this case doesn't need preambleAssignments either
      yield put(actions.assign(assignments));
      break;

    case "FunctionTypeName":
      //HACK
      //for some reasons, for declarations of local variables of function type,
      //we land on the FunctionTypeName instead of the VariableDeclaration,
      //so we replace the node with its parent (the VariableDeclaration)
      node = scopes[scopes[node.id].parentId].definition;
      //let's do a quick check that it *is* a VariableDeclaration before
      //continuing
      if (node.nodeType !== "VariableDeclaration") {
        break;
      }
    //otherwise, deliberately fall through to the VariableDeclaration case
    //NOTE: DELIBERATE FALL-THROUGH
    case "VariableDeclaration":
      let varId = node.id;
      debug("Variable declaration case");
      debug("currentDepth %d varId %d", currentDepth, varId);

      if (!inFunctionOrModifier) {
        //if we're not in a function or modifier, then this is a contract
        //variable, not a local variable, and should not be included
        debug("already a contract variable!");
        break;
      }

      //otherwise, go ahead and make the assignment
      assignment = makeAssignment(
        inModifier
          ? {
              compilationId,
              astRef: varId,
              stackframe: currentDepth,
              modifierDepth
            }
          : { compilationId, astRef: varId, stackframe: currentDepth },
        {
          location: "stack",
          from: top - Codec.Ast.Utils.stackSize(node) + 1,
          to: top
        }
      );
      assignments = { [assignment.id]: assignment };
      //this case doesn't need preambleAssignments either
      debug("assignments: %O", assignments);
      yield put(actions.assign(assignments));
      break;

    case "YulFunctionCall":
      if (nextPointer !== null && nextPointer.startsWith(pointer)) {
        //if we're moving inside the function call itself, ignore it
        break;
      }
    //NOTE: DELIBERATE FALL-THROUGH
    case "YulLiteral":
    case "YulIdentifier":
      //yul variable declaration, maybe
      let parentPointer = pointer.replace(/\/[^/]*$/, ""); //chop off end
      let root = yield select(data.current.root);
      let parent = jsonpointer.get(root, parentPointer);
      if (
        pointer !== `${parentPointer}/value` ||
        parent.nodeType !== "YulVariableDeclaration"
      ) {
        break;
      }
      node = parent;
      pointer = parentPointer;
    //NOTE: DELIBERATE FALL-THROUGH
    case "YulVariableDeclaration":
      const sourceAndPointer = makePath(sourceId, pointer);
      debug("sourceAndPointer: %s", sourceAndPointer);
      assignments = {};
      //variables go on from bottom to top, so process from top to bottom
      position = top; //NOTE: remember that which stack we use depends on our node type!
      for (let index = node.variables.length - 1; index >= 0; index--) {
        //we only care about the pointer, not the variable
        const variableSourceAndPointer = `${sourceAndPointer}/variables/${index}`;
        assignment = makeAssignment(
          inModifier
            ? {
                compilationId,
                astRef: variableSourceAndPointer,
                stackframe: currentDepth,
                modifierDepth
              }
            : {
                compilationId,
                astRef: variableSourceAndPointer,
                stackframe: currentDepth
              },
          {
            location: "stack",
            from: position, //all Yul variables are size 1
            to: position
          }
        );
        assignments[assignment.id] = assignment;
        position--;
      }

      //this case doesn't need preambleAssignments, obviously!
      yield put(actions.assign(assignments));
      break;

    case "IndexAccess":
      // to track `mapping` types known indices
      // (and also *some* known indices for arrays)

      //HACK: we use the alternate stack in this case

      debug("Index access case");

      //we're going to start by doing the same thing as in the default case
      //(see below) -- getting things ready for an assignment.  Then we're
      //going to forget this for a bit while we handle the rest...
      assignments = {
        ...preambleAssignments,
        ...literalAssignments(
          compilationId,
          node,
          stack,
          currentDepth,
          modifierDepth,
          inModifier
        )
      };

      //we'll need this
      baseExpression = node.baseExpression;

      //but first, a diversion -- is this something that could not *possibly*
      //lead to a mapping?  i.e., either a bytes, or an array of non-reference
      //types, or a non-storage array?
      //if so, we'll just do the assign and quit out early
      //(note: we write it this way because mappings aren't caught by
      //isReference)
      if (
        Codec.Ast.Utils.typeClass(baseExpression) === "bytes" ||
        (Codec.Ast.Utils.typeClass(baseExpression) === "array" &&
          (Codec.Ast.Utils.isReference(node)
            ? Codec.Ast.Utils.referenceType(baseExpression) !== "storage"
            : !Codec.Ast.Utils.isMapping(node)))
      ) {
        debug("Index case bailed out early");
        debug("typeClass %s", Codec.Ast.Utils.typeClass(baseExpression));
        debug(
          "referenceType %s",
          Codec.Ast.Utils.referenceType(baseExpression)
        );
        debug("isReference(node) %o", Codec.Ast.Utils.isReference(node));
        yield put(actions.assign(assignments));
        break;
      }

      let keyDefinition = Codec.Ast.Utils.keyDefinition(baseExpression, scopes);
      //if we're dealing with an array, this will just spoof up a uint
      //definition :)

      //now... the decoding! (this is messy)
      let indexValue = yield* decodeMappingKeySaga(
        node.indexExpression,
        keyDefinition
      );

      debug("index value %O", indexValue);
      debug("keyDefinition %o", keyDefinition);

      //whew! But we're not done yet -- we need to turn this decoded key into
      //an actual path (assuming we *did* decode it; we check both for null
      //and for the result being a Value and not an Error)
      //OK, not an actual path -- we're just going to use a simple offset for
      //the path.  But that's OK, because the mappedPaths reducer will turn
      //it into an actual path.
      if (indexValue != null && indexValue.value) {
        path = fetchBasePath(
          compilationId,
          baseExpression,
          mappedPaths,
          currentAssignments,
          currentDepth,
          modifierDepth,
          inModifier
        );

        let slot = { path };

        //we need to do things differently depending on whether we're dealing
        //with an array or mapping
        switch (Codec.Ast.Utils.typeClass(baseExpression)) {
          case "array":
            slot.hashPath = Codec.Ast.Utils.isDynamicArray(baseExpression);
            slot.offset = indexValue.value.asBN.muln(
              Codec.Storage.Allocate.storageSize(
                Codec.Ast.Import.definitionToType(
                  node,
                  compilationId,
                  compiler
                ),
                userDefinedTypes,
                storageAllocations
              ).words
            );
            break;
          case "mapping":
            slot.key = indexValue;
            slot.offset = new BN(0);
            break;
          default:
            debug("unrecognized index access!");
        }
        debug("slot %O", slot);

        //now, map it! (and do the assign as well)
        yield put(
          actions.mapPathAndAssign(
            address,
            slot,
            assignments,
            Codec.Ast.Utils.typeIdentifier(node),
            Codec.Ast.Utils.typeIdentifier(baseExpression)
          )
        );
      } else {
        //if we failed to decode, just do the assign from above
        debug("failed to decode, just assigning");
        yield put(actions.assign(assignments));
      }

      break;

    case "MemberAccess":
      //HACK: we use the alternate stack in this case

      //we're going to start by doing the same thing as in the default case
      //(see below) -- getting things ready for an assignment.  Then we're
      //going to forget this for a bit while we handle the rest...
      assignments = {
        ...preambleAssignments,
        ...literalAssignments(
          compilationId,
          node,
          stack,
          currentDepth,
          modifierDepth,
          inModifier
        )
      };

      debug("Member access case");

      //MemberAccess uses expression, not baseExpression
      baseExpression = node.expression;

      //if this isn't a storage struct, or the element isn't of reference type,
      //we'll just do the assignment and quit out (again, note that mappings
      //aren't caught by isReference)
      if (
        Codec.Ast.Utils.typeClass(baseExpression) !== "struct" ||
        (Codec.Ast.Utils.isReference(node)
          ? Codec.Ast.Utils.referenceType(baseExpression) !== "storage"
          : !Codec.Ast.Utils.isMapping(node))
      ) {
        debug("Member case bailed out early");
        yield put(actions.assign(assignments));
        break;
      }

      //but if it is a storage struct, we have to map the path as well
      path = fetchBasePath(
        compilationId,
        baseExpression,
        mappedPaths,
        currentAssignments,
        currentDepth,
        modifierDepth,
        inModifier
      );

      slot = { path };

      let structType = Codec.Ast.Import.definitionToType(
        baseExpression,
        compilationId,
        compiler
      );
      let memberAllocations = storageAllocations[structType.id].members;
      //members of a given struct have unique names so it's safe to look up the member by name
      let memberName = scopes[node.referencedDeclaration].definition.name;
      let memberAllocation = memberAllocations.find(
        member => member.name === memberName
      );

      slot.offset = memberAllocation.pointer.range.from.slot.offset.clone();

      debug("slot %o", slot);
      yield put(
        actions.mapPathAndAssign(
          address,
          slot,
          assignments,
          Codec.Ast.Utils.typeIdentifier(node),
          Codec.Ast.Utils.typeIdentifier(baseExpression)
        )
      );
      break;

    default:
      if (node.id === undefined || node.typeDescriptions == undefined) {
        break;
      }

      debug("decoding expression value %O", node.typeDescriptions);
      debug("default case");
      debug("currentDepth %d node.id %d", currentDepth, node.id);

      assignments = {
        ...preambleAssignments,
        ...literalAssignments(
          compilationId,
          node,
          stack,
          currentDepth,
          modifierDepth,
          inModifier
        )
      };
      yield put(actions.assign(assignments));
      break;
  }
}

function* decodeMappingKeySaga(indexDefinition, keyDefinition) {
  //something of a HACK -- cleans any out-of-range booleans
  //resulting from the main mapping key decoding loop
  let indexValue = yield* decodeMappingKeyCore(indexDefinition, keyDefinition);
  return indexValue ? Codec.Conversion.cleanBool(indexValue) : indexValue;
}

function* decodeMappingKeyCore(indexDefinition, keyDefinition) {
  let scopes = yield select(data.current.scopes.inlined);
  let compilationId = yield select(data.current.compilationId);
  let currentAssignments = yield select(data.proc.assignments);
  let currentDepth = yield select(data.current.functionDepth);
  let modifierDepth = yield select(data.current.modifierDepth);
  let inModifier = yield select(data.current.inModifier);

  //why the loop? see the end of the block it heads for an explanatory
  //comment
  while (true) {
    let indexId = indexDefinition.id;
    //indices need to be identified by stackframe
    let indexIdObj = inModifier
      ? {
          compilationId,
          astRef: indexId,
          stackframe: currentDepth,
          modifierDepth
        }
      : { compilationId, astRef: indexId, stackframe: currentDepth };
    let fullIndexId = stableKeccak256(indexIdObj);

    const indexReference = (currentAssignments.byId[fullIndexId] || {}).ref;

    if (Codec.Ast.Utils.isSimpleConstant(indexDefinition)) {
      //while the main case is the next one, where we look for a prior
      //assignment, we need this case (and need it first) for two reasons:
      //1. some constant expressions (specifically, string and hex literals)
      //aren't sourcemapped to and so won't have a prior assignment
      //2. if the key type is bytesN but the expression is constant, the
      //value will go on the stack *left*-padded instead of right-padded,
      //so looking for a prior assignment will read the wrong value.
      //so instead it's preferable to use the constant directly.
      debug("about to decode simple literal");
      return yield* decode(
        keyDefinition,
        {
          location: "definition",
          definition: indexDefinition
        },
        compilationId
      );
    } else if (indexReference) {
      //if a prior assignment is found
      let splicedDefinition;
      //in general, we want to decode using the key definition, not the index
      //definition. however, the key definition may have the wrong location
      //on it.  so, when applicable, we splice the index definition location
      //onto the key definition location.
      if (Codec.Ast.Utils.isReference(indexDefinition)) {
        splicedDefinition = Codec.Ast.Utils.spliceLocation(
          keyDefinition,
          Codec.Ast.Utils.referenceType(indexDefinition)
        );
        //we could put code here to add on the "_ptr" ending when absent,
        //but we presently ignore that ending, so we'll skip that
      } else {
        splicedDefinition = keyDefinition;
      }
      debug("about to decode");
      return yield* decode(splicedDefinition, indexReference, compilationId);
    } else if (
      indexDefinition.referencedDeclaration &&
      scopes[indexDefinition.referencedDeclaration]
    ) {
      //there's one more reason we might have failed to decode it: it might be a
      //constant state variable.  Unfortunately, we don't know how to decode all
      //those at the moment, but we can handle the ones we do know how to decode.
      //In the future hopefully we will decode all of them
      debug("referencedDeclaration %d", indexDefinition.referencedDeclaration);
      let indexConstantDeclaration =
        scopes[indexDefinition.referencedDeclaration].definition;
      debug("indexConstantDeclaration %O", indexConstantDeclaration);
      if (indexConstantDeclaration.constant) {
        let indexConstantDefinition = indexConstantDeclaration.value;
        //next line filters out constants we don't know how to handle
        if (Codec.Ast.Utils.isSimpleConstant(indexConstantDefinition)) {
          debug("about to decode simple constant");
          return yield* decode(
            keyDefinition,
            {
              location: "definition",
              definition: indexConstantDeclaration.value
            },
            compilationId
          );
        } else {
          return null; //can't decode; see below for more explanation
        }
      } else {
        return null; //can't decode; see below for more explanation
      }
    }
    //there's still one more reason we might have failed to decode it:
    //certain (silent) type conversions aren't sourcemapped either.
    //(thankfully, any type conversion that actually *does* something seems
    //to be sourcemapped.)  So if we've failed to decode it, we try again
    //with the argument of the type conversion, if it is one; we leave
    //indexValue undefined so the loop will continue
    //(note that this case is last for a reason; if this were earlier, it
    //would catch *non*-silent type conversions, which we want to just read
    //off the stack)
    else if (indexDefinition.kind === "typeConversion") {
      indexDefinition = indexDefinition.arguments[0];
    }
    //...also prior to 0.5.0, unary + was legal, which needs to be accounted
    //for for the same reason
    else if (
      indexDefinition.nodeType === "UnaryOperation" &&
      indexDefinition.operator === "+"
    ) {
      indexDefinition = indexDefinition.subExpression;
    }
    //otherwise, we've just totally failed to decode it, so we mark
    //indexValue as null (as distinct from undefined) to indicate this.  In
    //the future, we should be able to decode all mapping keys, but we're
    //not quite there yet, sorry (because we can't yet handle all constant
    //state variables)
    else {
      return null;
    }
    //now, as mentioned, retry in the typeConversion case
    //(or unary + case)
  }
}

export function* reset() {
  yield put(actions.reset());
}

export function* recordAllocations() {
  const contracts = yield select(data.views.contractAllocationInfo);
  debug("contracts %O", contracts);
  const referenceDeclarations = yield select(data.views.referenceDeclarations);
  const userDefinedTypes = yield select(data.views.userDefinedTypes);
  debug("referenceDeclarations %O", referenceDeclarations);
  const storageAllocations = Codec.Storage.Allocate.getStorageAllocations(
    userDefinedTypes
  );
  debug("storageAllocations %O", storageAllocations);
  const memoryAllocations = Codec.Memory.Allocate.getMemoryAllocations(
    userDefinedTypes
  );
  const abiAllocations = Codec.AbiData.Allocate.getAbiAllocations(
    userDefinedTypes
  );
  const calldataAllocations = Codec.AbiData.Allocate.getCalldataAllocations(
    contracts,
    referenceDeclarations,
    userDefinedTypes,
    abiAllocations
  );
  const stateAllocations = Codec.Storage.Allocate.getStateAllocations(
    contracts,
    referenceDeclarations,
    userDefinedTypes,
    storageAllocations
  );
  yield put(
    actions.allocate(
      storageAllocations,
      memoryAllocations,
      abiAllocations,
      calldataAllocations,
      stateAllocations
    )
  );
}

function literalAssignments(
  compilationId,
  node,
  stack,
  currentDepth,
  modifierDepth,
  inModifier
) {
  let top = stack.length - 1;

  let literal;
  try {
    literal = Codec.Stack.Read.readStack(
      {
        location: "stack",
        from: top - Codec.Ast.Utils.stackSize(node) + 1,
        to: top
      },
      {
        stack,
        storage: {} //irrelevant, but let's respect the type signature :)
      }
    );
  } catch (error) {
    literal = undefined; //not sure if this is right, but this is what would
    //happen before, so I figure it's safe?
  }

  let assignment = makeAssignment(
    inModifier
      ? {
          compilationId,
          astRef: node.id,
          stackframe: currentDepth,
          modifierDepth
        }
      : { compilationId, astRef: node.id, stackframe: currentDepth },
    { location: "stackliteral", literal }
  );

  return { [assignment.id]: assignment };
}

//takes a parameter list as given in the AST
function assignParameters(
  compilationId,
  parameters,
  top,
  functionDepth,
  modifierDepth = 0,
  forModifier = false
) {
  let reverseParameters = parameters.slice().reverse();
  //reverse is in-place, so we use slice() to clone first
  debug("reverseParameters %o", parameters);

  let currentPosition = top;
  let assignments = {};

  for (let parameter of reverseParameters) {
    let words = Codec.Ast.Utils.stackSize(parameter);
    let pointer = {
      location: "stack",
      from: currentPosition - words + 1,
      to: currentPosition
    };
    let assignment = makeAssignment(
      forModifier
        ? {
            compilationId,
            astRef: parameter.id,
            stackframe: functionDepth,
            modifierDepth
          }
        : { compilationId, astRef: parameter.id, stackframe: functionDepth },
      pointer
    );
    assignments[assignment.id] = assignment;
    currentPosition -= words;
  }
  return assignments;
}

function fetchBasePath(
  compilationId,
  baseNode,
  mappedPaths,
  currentAssignments,
  currentDepth,
  modifierDepth,
  inModifier
) {
  let fullId = stableKeccak256(
    inModifier
      ? {
          compilationId,
          astRef: baseNode.id,
          stackframe: currentDepth,
          modifierDepth
        }
      : {
          compilationId,
          astRef: baseNode.id,
          stackframe: currentDepth
        }
  );
  debug("astId: %d", baseNode.id);
  debug("stackframe: %d", currentDepth);
  debug("fullId: %s", fullId);
  debug("currentAssignments: %O", currentAssignments);
  //base expression is an expression, and so has a literal assigned to
  //it
  let offset = Codec.Conversion.toBN(
    currentAssignments.byId[fullId].ref.literal
  );
  return { offset };
}

export function* saga() {
  yield takeEvery(TICK, tickSaga);
}

export default prefixName("data", saga);
